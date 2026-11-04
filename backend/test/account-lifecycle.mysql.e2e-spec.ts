import { createConnection } from 'mysql2/promise';
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';

/**
 * 临时密码与强制改密闭环（任务 03）：完整 AppModule + 隔离 MySQL + 真实 HTTP。
 * 种子在空库初始化 admin 时即标记待改密（第一批行为），本套件从初始登录走完全链路。
 * 登录次数受联合限流约束（IP 20/分钟、账号 10/15 分钟），用例设计保持在配额内。
 */
const suite = process.env.TEST_LIFECYCLE_DATABASE ? describe : describe.skip;
suite('临时密码与强制改密闭环：隔离 MySQL + HTTP', () => {
  const database = process.env.TEST_LIFECYCLE_DATABASE!;
  const adminInitialPassword = 'e2e-admin-initial-2026';
  let app: import('@nestjs/common').INestApplication;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const server = () => app.getHttpServer();
  const cookieOf = (response: request.Response) =>
    (response.headers['set-cookie'] ?? []).map(String).find((c) => c.startsWith('access_token='))?.split(';')[0];

  const loginPost = (loginid: string, password: string) =>
    request(server()).post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send({ loginid, password });

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;

    // 环境必须在 AppModule 导入（ConfigModule 求值）之前就位；
    // Jest VM 不支持动态 import，用 require 保证求值时机在环境设置之后。
    process.env.DB_DATABASE = database;
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.ADMIN_DEFAULT_PASSWORD = adminInitialPassword;
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApplication } = require('../src/app.setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NestFactory } = require('@nestjs/core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigService } = require('@nestjs/config');
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app, app.get(ConfigService));
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  const userIdOf = async (username: string) => {
    const [rows] = await admin.query(`SELECT id FROM \`${database}\`.users WHERE username = ?`, [username]);
    return (rows as any[])[0].id as number;
  };

  it('初始 admin 登录即受限：最小身份、白名单外接口 403，改密后恢复完整会话', async () => {
    const login = await loginPost('admin', adminInitialPassword);
    expect(login.status).toBe(201);
    expect(login.body.data.user).toEqual({
      id: expect.any(Number), username: 'admin', displayName: '系统管理员', mustChangePassword: true,
    });
    const restrictedCookie = cookieOf(login)!;

    const profile = await request(server()).get('/api/v1/auth/profile').set('Cookie', restrictedCookie);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ username: 'admin', mustChangePassword: true });
    expect(profile.body.data).not.toHaveProperty('menus');

    // 白名单外：权限码、用户简表、示例事项一律拒绝（受限会话 Cookie 直连）
    for (const path of ['/api/v1/auth/codes', '/api/v1/users/simple', '/api/v1/examples/items']) {
      const blocked = await request(server()).get(path).set('Cookie', restrictedCookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.reason).toBe('PASSWORD_CHANGE_REQUIRED');
    }

    // 改密成功清 Cookie；旧受限会话立即失效
    const change = await request(server()).patch('/api/v1/auth/password')
      .set('Cookie', restrictedCookie)
      .send({ oldPassword: adminInitialPassword, newPassword: 'admin-renewed-2026', confirmPassword: 'admin-renewed-2026' });
    expect(change.status).toBe(200);
    // 清除后的 Cookie 值为空
    expect(cookieOf(change)).toMatch(/^access_token=;|^access_token=$/);
    const dead = await request(server()).get('/api/v1/auth/profile').set('Cookie', restrictedCookie);
    expect(dead.status).toBe(401);

    const renewed = await loginPost('admin', 'admin-renewed-2026');
    expect(renewed.status).toBe(201);
    expect(renewed.body.data.user.mustChangePassword).toBeUndefined();
    const codes = await request(server()).get('/api/v1/auth/codes').set('Cookie', cookieOf(renewed)!);
    expect(codes.status).toBe(200);
  });

  it('创建用户拒绝旧 password 入参；无入参时返回一次性临时密码并登录受限', async () => {
    const adminLogin = await loginPost('admin', 'admin-renewed-2026');
    const cookie = cookieOf(adminLogin)!;
    const rejected = await request(server()).post('/api/v1/users').set('Cookie', cookie)
      .send({ loginid: 'e2e-user-a', password: 'not-allowed-123', displayName: '用户甲' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('临时密码');

    const createdUser = await request(server()).post('/api/v1/users').set('Cookie', cookie)
      .send({ loginid: 'e2e-user-a', displayName: '用户甲' });
    expect(createdUser.status).toBe(201);
    expect(createdUser.headers['cache-control']).toContain('no-store');
    const credential = createdUser.body.data.temporaryPassword as string;
    expect(credential).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(createdUser.body.data.expiresAt).toBeTruthy();
    // 详情不回带明文
    const detail = await request(server()).get(`/api/v1/users/${createdUser.body.data.id}`).set('Cookie', cookie);
    expect(detail.body.data).not.toHaveProperty('temporaryPassword');

    const firstLogin = await loginPost('e2e-user-a', credential);
    expect(firstLogin.status).toBe(201);
    expect(firstLogin.body.data.user).toMatchObject({ username: 'e2e-user-a', mustChangePassword: true });
  });

  it('编辑用户拒绝非空 password；重置自目标拒绝、正常重置后旧密码立即失效', async () => {
    const adminLogin = await loginPost('admin', 'admin-renewed-2026');
    const cookie = cookieOf(adminLogin)!;
    const targetId = await userIdOf('e2e-user-a');
    const adminId = await userIdOf('admin');

    const editRejected = await request(server()).put(`/api/v1/users/${targetId}`).set('Cookie', cookie)
      .send({ password: 'sneaky-password-1' });
    expect(editRejected.status).toBe(400);
    expect(editRejected.body.message).toContain('重置密码');

    const selfReset = await request(server()).post(`/api/v1/users/${adminId}/reset-password`).set('Cookie', cookie).send({});
    expect(selfReset.status).toBe(403);

    const reset = await request(server()).post(`/api/v1/users/${targetId}/reset-password`).set('Cookie', cookie).send({});
    expect(reset.status).toBe(201);
    expect(reset.headers['cache-control']).toContain('no-store');
    const tempPassword = reset.body.data.temporaryPassword as string;
    expect(tempPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);

    // 重置后旧凭据失效（一次错误登录计入账号失败配额）
    const stale = await loginPost('e2e-user-a', 'user-a-old-should-fail');
    expect(stale.status).toBe(401);
    const fresh = await loginPost('e2e-user-a', tempPassword);
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.user).toMatchObject({ mustChangePassword: true });
  });

  it('临时密码到期：会话中途到期下一请求 401；到期后凭据正确也不再签发会话', async () => {
    const adminLogin = await loginPost('admin', 'admin-renewed-2026');
    const cookie = cookieOf(adminLogin)!;
    const targetId = await userIdOf('e2e-user-a');
    const reset = await request(server()).post(`/api/v1/users/${targetId}/reset-password`).set('Cookie', cookie).send({});
    const tempPassword = reset.body.data.temporaryPassword as string;

    // 会话中到期：先登录拿受限会话，再把到期时间改到过去
    const session = await loginPost('e2e-user-a', tempPassword);
    expect(session.status).toBe(201);
    await admin.query(`UPDATE \`${database}\`.users SET temporary_password_expires_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE id = ?`, [targetId]);
    const expired = await request(server()).get('/api/v1/auth/profile').set('Cookie', cookieOf(session)!);
    expect(expired.status).toBe(401);
    expect(expired.body.reason).toBe('TEMPORARY_PASSWORD_EXPIRED');

    const denied = await loginPost('e2e-user-a', tempPassword);
    expect(denied.status).toBe(401);
    expect(denied.body.reason).toBe('TEMPORARY_PASSWORD_EXPIRED');
  });

  it('退出全部登录：Cookie/Bearer 旧凭据同失效，他人不受影响，原密码可重登，重试只增版本', async () => {
    const adminLogin = await loginPost('admin', 'admin-renewed-2026');
    const adminCookie = cookieOf(adminLogin)!;
    // user-b 走完整激活（临时密码 → 改密）后建立两份正常会话
    const created = await request(server()).post('/api/v1/users').set('Cookie', adminCookie)
      .send({ loginid: 'e2e-user-b', displayName: '用户乙' });
    const tempB = created.body.data.temporaryPassword as string;
    const restricted = await loginPost('e2e-user-b', tempB);
    const changeB = await request(server()).patch('/api/v1/auth/password').set('Cookie', cookieOf(restricted)!)
      .send({ oldPassword: tempB, newPassword: 'user-b-final-2026', confirmPassword: 'user-b-final-2026' });
    expect(changeB.status).toBe(200);
    const sessionA = await loginPost('e2e-user-b', 'user-b-final-2026');
    const sessionB = await loginPost('e2e-user-b', 'user-b-final-2026');
    const bearerToken = cookieOf(sessionA)!.slice('access_token='.length);
    const targetId = await userIdOf('e2e-user-b');
    const [beforeRows] = await admin.query(`SELECT token_version AS v FROM \`${database}\`.users WHERE id = ?`, [targetId]);
    const beforeVersion = Number((beforeRows as any[])[0].v);

    const revoke = await request(server()).post(`/api/v1/users/${targetId}/revoke-sessions`).set('Cookie', adminCookie).send({});
    expect(revoke.status).toBe(201);
    expect(revoke.body.data.message).toContain('重新登录');

    // 提交后的新鉴权：Cookie 与 Bearer 旧凭据一并失效
    await request(server()).get('/api/v1/auth/profile').set('Cookie', cookieOf(sessionB)!).expect(401);
    await request(server()).get('/api/v1/auth/profile').set('Authorization', `Bearer ${bearerToken}`).expect(401);
    // 其他账号会话不受影响
    await request(server()).get('/api/v1/auth/profile').set('Cookie', adminCookie).expect(200);
    // 撤销不等于禁用：原密码仍可重新登录
    const relogin = await loginPost('e2e-user-b', 'user-b-final-2026');
    expect(relogin.status).toBe(201);
    // 重试撤销只递增不降低，且使重登会话再次失效
    const retry = await request(server()).post(`/api/v1/users/${targetId}/revoke-sessions`).set('Cookie', adminCookie).send({});
    expect(retry.status).toBe(201);
    const [afterRows] = await admin.query(`SELECT token_version AS v FROM \`${database}\`.users WHERE id = ?`, [targetId]);
    expect(Number((afterRows as any[])[0].v)).toBeGreaterThanOrEqual(beforeVersion + 2);
    await request(server()).get('/api/v1/auth/profile').set('Cookie', cookieOf(relogin)!).expect(401);
  });

  it('审计链路：改密/重置事件入库且不含明文密码', async () => {
    const [logs] = await admin.query(
      `SELECT detail FROM \`${database}\`.system_logs WHERE entity_type IN ('auth','users')`,
    );
    const details = (logs as any[]).map((r) => String(r.detail)).join('\n');
    expect(details).toContain('"event":"password_changed"');
    expect(details).toContain('"event":"password_reset"');
    expect(details).toContain('"event":"sessions_revoked"');
    expect(details).not.toContain('admin-renewed-2026');
    expect(details).not.toMatch(/[A-HJ-NP-Za-km-z2-9]{20}/);
  });

  it('本机恢复命令：交互确认后输出一次性凭据，可登录且必须改密', async () => {
    const run = () => new Promise<string>((resolveOut, reject) => {
      exec(
        `echo y | "${process.execPath.replace(/\\/g, '/')}" -r "${resolve('node_modules/ts-node/register').replace(/\\/g, '/')}" -r "${resolve('node_modules/tsconfig-paths/register').replace(/\\/g, '/')}" src/recovery-cli.ts admin`,
        { cwd: process.cwd(), env: process.env, timeout: 90000 },
        (error, stdout) => (error ? reject(new Error(`${error.message}\n${stdout}`)) : resolveOut(stdout)),
      );
    });
    const stdout = await run();
    expect(stdout).toContain('临时密码');
    const match = stdout.match(/[A-HJ-NP-Za-km-z2-9]{20}/);
    expect(match).toBeTruthy();
    const recovered = await loginPost('admin', match![0]);
    expect(recovered.status).toBe(201);
    expect(recovered.body.data.user).toMatchObject({ username: 'admin', mustChangePassword: true });
  }, 120000);
});
