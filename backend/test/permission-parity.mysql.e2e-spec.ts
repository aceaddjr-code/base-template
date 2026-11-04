import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';

/**
 * 权限效果解释对照验收（第二批 04）：完整 AppModule＋隔离 MySQL＋真实 HTTP。
 * 逐场景比对「admin 调解释接口的结论」与「目标用户以全新登录请求实际接口的结果」，
 * 覆盖 action-map §6 对照矩阵：四档范围、六开关组合、部门子树、未配置回退、
 * 角色停用＋版本失效、admin 例外、无归属、软删除、账号层（待改密/禁用）与附件 unsupported。
 * 写请求只作用于隔离库（整库随用例销毁）；IP 配额调高避免噪声，账号配额仍生效。
 */
const suite = process.env.TEST_PARITY_DATABASE ? describe : describe.skip;
suite('权限效果解释：解释 vs 实际请求对照', () => {
  const database = process.env.TEST_PARITY_DATABASE!;
  const password = 'parity-target-2026';
  const adminPassword = 'parity-admin-2026';
  let app: import('@nestjs/common').INestApplication;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const server = () => app.getHttpServer();
  const ids: Record<string, number> = {};
  const recordIds: Record<string, number> = {};

  const loginPost = (loginid: string, pw: string) =>
    request(server()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ loginid, password: pw });
  const cookieOf = (response: request.Response) =>
    (response.headers['set-cookie'] ?? []).map(String).find((c) => c.startsWith('access_token='))?.split(';')[0];

  const explain = async (adminCookie: string, targetId: number, recordId?: number) => {
    const response = await request(server())
      .get(`/api/v1/users/${targetId}/permission-explanation`)
      .query({ scopeKey: 'example-items', ...(recordId != null ? { recordId } : {}) })
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    return response.body.data;
  };
  const verdictOf = (data: any, action: string) => data.recordEvaluation.find((item: any) => item.action === action);

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    await admin.changeUser({ database });

    process.env.DB_DATABASE = database;
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_DEFAULT_PASSWORD = 'parity-admin-initial-2026';
    process.env.LOGIN_IP_MAX = '500';
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

    // 管理员完成初始改密，拿到稳定会话
    const initial = await loginPost('admin', 'parity-admin-initial-2026');
    expect(initial.status).toBe(201);
    await request(server()).patch('/api/v1/auth/password').set('Cookie', cookieOf(initial)!)
      .send({ oldPassword: 'parity-admin-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword });
    const adminLogin = await loginPost('admin', adminPassword);
    (ids as any).adminCookie = cookieOf(adminLogin);

    await arrange();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  const q = async (sql: string, params?: unknown[]) => {
    try {
      return (await admin.query(sql, params)) as any;
    } catch (error) {
      throw new Error(`SQL 失败: ${error instanceof Error ? error.message : error}\n  语句: ${sql}\n  参数: ${JSON.stringify(params)}`);
    }
  };

  /** 隔离库内直接编排：部门树/业务角色/目标用户/范围配置/记录。密码为已知值以便全新登录。 */
  async function arrange() {
    const hash = await bcrypt.hash(password, 10);
    const depts = await q(
      `INSERT INTO departments (name, code, parent_id, status, sort, created_at, updated_at) VALUES
        ('总部','hq',NULL,1,1,NOW(6),NOW(6)), ('部门A','a',NULL,1,1,NOW(6),NOW(6)), ('子部门A1','a1',NULL,1,1,NOW(6),NOW(6)), ('部门B','b',NULL,1,2,NOW(6),NOW(6))`);
    void depts;
    const [deptRows] = await q('SELECT id, code FROM departments');
    const dept = Object.fromEntries((deptRows as any[]).map((r) => [r.code, r.id]));
    await q('UPDATE departments SET parent_id = ? WHERE code = ?', [dept.a, 'a1']);

    await q(`INSERT INTO roles (id, name, code, status, created_at, updated_at) VALUES
      (50, '业务角色', 'biz', 1, NOW(6), NOW(6))`);
    // 业务角色授予示例事项四个动作码（种子已建按钮节点）
    const [menuRows] = await q(`SELECT id, permission FROM menus WHERE permission IN ('example-items:view','example-items:update','example-items:delete','example-items:export') AND deleted_at IS NULL`);
    for (const menu of menuRows as any[]) {
      await q('INSERT INTO role_menus (role_id, menu_id) VALUES (50, ?)', [menu.id]);
    }

    const mkUser = async (username: string, deptId: number | null) => {
      const [row]: any = await q(
        'INSERT INTO users (username, display_name, password, status, token_version, role_id, dept_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 50, ?, NOW(6), NOW(6))',
        [username, username, hash, deptId]);
      const userId = Number(row.insertId);
      // 权限码与身份解析读取 user_roles 关联（主角色列只用于展示兜底）
      await q('INSERT INTO user_roles (user_id, role_id, owner_id, created_by, created_at, updated_at) VALUES (?, 50, ?, ?, NOW(6), NOW(6))', [userId, userId, userId]);
      return userId;
    };
    ids.admin = (await q("SELECT id FROM users WHERE username='admin'"))[0][0].id;
    ids.peerA1 = await mkUser('parity-peer-a1', dept.a1);
    ids.peerB = await mkUser('parity-peer-b', dept.b);
    ids.uSelf = await mkUser('parity-self', dept.hq);
    ids.uView = await mkUser('parity-view', dept.hq);
    ids.uSwitch = await mkUser('parity-switch', dept.hq);
    ids.uDept = await mkUser('parity-dept', dept.hq);
    ids.uFallback = await mkUser('parity-fallback', dept.hq);
    ids.uAdmin = await mkUser('parity-mini-admin', dept.hq);
    await q('INSERT INTO user_roles (user_id, role_id, owner_id, created_by, created_at, updated_at) VALUES (?, 1, ?, ?, NOW(6), NOW(6))', [ids.uAdmin, ids.uAdmin, ids.uAdmin]);

    // mini-admin：主角色 admin（种子角色 id=1）
    await q('UPDATE users SET role_id = 1 WHERE id = ?', [ids.uAdmin]);

    const mkScope = async (userId: number, scopeType: string, targets: number[], flags: Partial<Record<string, number>>) => {
      const defaults = { viewOthers: 0, editOthers: 0, deleteOthers: 0, viewSelf: 1, editSelf: 1, deleteSelf: 1 };
      const merged = { ...defaults, ...flags };
      const [row]: any = await q(
        'INSERT INTO user_data_scopes (user_id, scope_key, scope_type, view_others, edit_others, delete_others, view_self, edit_self, delete_self, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(6), NOW(6))',
        [userId, 'example-items', scopeType, merged.viewOthers, merged.editOthers, merged.deleteOthers, merged.viewSelf, merged.editSelf, merged.deleteSelf, userId]);
      for (const target of targets) {
        await q('INSERT INTO user_data_scope_targets (user_data_scope_id, target_type, target_id) VALUES (?, ?, ?)', [row.insertId, scopeType === 'by_depts' ? 'dept' : 'user', target]);
      }
    };
    await mkScope(ids.uSelf, 'self', [], {});
    await mkScope(ids.uView, 'by_users', [ids.peerA1], { viewOthers: 1 });
    await mkScope(ids.uSwitch, 'self', [], { viewSelf: 0 });
    await mkScope(ids.uDept, 'by_depts', [dept.a], { viewOthers: 1, editOthers: 1, deleteOthers: 1 });
    // uFallback 不配置任何行 → 未配置回退仅本人

    const mkRecord = async (title: string, ownerId: number | null) => {
      const [row]: any = await q(
        "INSERT INTO example_items (title, status, version, doc_no, owner_id, created_by, created_at, updated_at) VALUES (?, 'pending', 1, NULL, ?, ?, NOW(6), NOW(6))",
        [title, ownerId, ownerId ?? ids.admin]);
      return Number(row.insertId);
    };
    recordIds.own = await mkRecord('本人的单据', ids.uSelf);
    recordIds.peerA1 = await mkRecord('子部门A1同事的单据', ids.peerA1);
    recordIds.peerB = await mkRecord('部门B同事的单据', ids.peerB);
    recordIds.noOwner = await mkRecord('无归属人的单据', null);
  }

  const freshSession = async (username: string) => {
    const response = await loginPost(username, password);
    expect(response.status).toBe(201);
    return cookieOf(response)!;
  };

  it('self 档本人记录：解释 allowed 与实际 200/写成功一致', async () => {
    const cookie = (ids as any).adminCookie as string;
    const data = await explain(cookie, ids.uSelf, recordIds.own);
    expect(data.account.status).toBe(1);
    for (const action of ['list', 'detail', 'update', 'delete', 'export']) {
      expect(verdictOf(data, action).result).toBe('allowed');
    }
    const session = await freshSession('parity-self');
    const list = await request(server()).get('/api/v1/examples/items').query({ keyword: '本人的单据' }).set('Cookie', session);
    expect(list.body.data.list.some((item: any) => item.id === recordIds.own)).toBe(true);
    await request(server()).get(`/api/v1/examples/items/${recordIds.own}`).set('Cookie', session).expect(200);
    await request(server()).get(`/api/v1/examples/items/export?ids=${recordIds.own}`).set('Cookie', session).expect(200);
    const update = await request(server()).put(`/api/v1/examples/items/${recordIds.own}`).set('Cookie', session)
      .send({ title: '本人的单据（改）', status: 'pending', version: 1 });
    expect(update.status).toBe(200);
  });

  it('by_users 仅开查看：他人记录 detail/export allowed，update/delete 403 一致', async () => {
    const cookie = (ids as any).adminCookie as string;
    const data = await explain(cookie, ids.uView, recordIds.peerA1);
    expect(verdictOf(data, 'detail').result).toBe('allowed');
    expect(verdictOf(data, 'export').result).toBe('allowed');
    expect(verdictOf(data, 'update').reasonCodes).toEqual(['OTHERS_SWITCH_OFF']);
    expect(verdictOf(data, 'delete').reasonCodes).toEqual(['OTHERS_SWITCH_OFF']);
    const session = await freshSession('parity-view');
    await request(server()).get(`/api/v1/examples/items/${recordIds.peerA1}`).set('Cookie', session).expect(200);
    await request(server()).put(`/api/v1/examples/items/${recordIds.peerA1}`).set('Cookie', session)
      .send({ title: 'x', status: 'pending', version: 1 }).expect(403);
    await request(server()).delete(`/api/v1/examples/items/${recordIds.peerA1}`).set('Cookie', session).expect(403);
  });

  async function mkOwnForSwitch(): Promise<number> {
    // uSwitch 的本人记录（单独一条，避免影响其他用例）
    if (!recordIds.ownSwitch) {
      const [row]: any = await q(
        "INSERT INTO example_items (title, status, version, doc_no, owner_id, created_by, created_at, updated_at) VALUES ('开关用本人单据', 'pending', 1, NULL, ?, ?, NOW(6), NOW(6))",
        [ids.uSwitch, ids.uSwitch]);
      recordIds.ownSwitch = Number(row.insertId);
    }
    return recordIds.ownSwitch;
  }

  it('viewSelf=0 对照：解释 SELF_SWITCH_OFF / EDIT_REQUIRES_VIEW，实际详情 403、列表可见', async () => {
    const recordId = await mkOwnForSwitch();
    const cookie = (ids as any).adminCookie as string;
    const data = await explain(cookie, ids.uSwitch, recordId);
    expect(verdictOf(data, 'list').result).toBe('allowed');
    expect(verdictOf(data, 'detail').reasonCodes).toEqual(['SELF_SWITCH_OFF']);
    expect(verdictOf(data, 'export').reasonCodes).toEqual(['SELF_SWITCH_OFF']);
    expect(verdictOf(data, 'update').reasonCodes).toEqual(['EDIT_REQUIRES_VIEW']);
    const session = await freshSession('parity-switch');
    const list = await request(server()).get('/api/v1/examples/items').query({ keyword: '开关用本人单据' }).set('Cookie', session);
    expect(list.body.data.list.some((item: any) => item.id === recordId)).toBe(true);
    // 记录在共同范围内、开关层拒绝：实际为 403（非 404，不冒充查不到）
    await request(server()).get(`/api/v1/examples/items/${recordId}`).set('Cookie', session).expect(403);
  });

  it('by_depts 子树：子部门内一致 allowed；子树外一致 404/RECORD_NOT_FOUND', async () => {
    const cookie = (ids as any).adminCookie as string;
    const inside = await explain(cookie, ids.uDept, recordIds.peerA1);
    for (const action of ['list', 'detail', 'update', 'delete', 'export']) expect(verdictOf(inside, action).result).toBe('allowed');
    const outside = await explain(cookie, ids.uDept, recordIds.peerB);
    for (const action of ['list', 'detail', 'update', 'delete', 'export']) {
      expect(verdictOf(outside, action).reasonCodes).toEqual(['RECORD_NOT_FOUND']);
    }
    const session = await freshSession('parity-dept');
    await request(server()).get(`/api/v1/examples/items/${recordIds.peerA1}`).set('Cookie', session).expect(200);
    await request(server()).get(`/api/v1/examples/items/${recordIds.peerB}`).set('Cookie', session).expect(404);
    const list = await request(server()).get('/api/v1/examples/items').query({ keyword: '部门B同事的单据' }).set('Cookie', session);
    expect(list.body.data.list.length).toBe(0);
  });

  it('未配置表单回退仅本人：他人 404、本人 200，解释 fallback 语义一致', async () => {
    const cookie = (ids as any).adminCookie as string;
    const others = await explain(cookie, ids.uFallback, recordIds.peerA1);
    expect(others.configSource.fallback).toBe('self_only');
    expect(others.dataScope.scopeType).toBe('fallback_self');
    for (const action of ['list', 'detail', 'update', 'delete', 'export']) {
      expect(verdictOf(others, action).reasonCodes).toEqual(['RECORD_NOT_FOUND']);
    }
    const [ownRow]: any = await q(
      "INSERT INTO example_items (title, status, version, doc_no, owner_id, created_by, created_at, updated_at) VALUES ('回退用本人单据', 'pending', 1, NULL, ?, ?, NOW(6), NOW(6))",
      [ids.uFallback, ids.uFallback]);
    const own = await explain(cookie, ids.uFallback, Number(ownRow.insertId));
    expect(verdictOf(own, 'detail').result).toBe('allowed');
    const session = await freshSession('parity-fallback');
    await request(server()).get(`/api/v1/examples/items/${recordIds.peerA1}`).set('Cookie', session).expect(404);
    await request(server()).get(`/api/v1/examples/items/${ownRow.insertId}`).set('Cookie', session).expect(200);
  });

  it('授权收回＋版本递增：解释 OPERATION_PERMISSION_MISSING、旧 JWT 401、新会话 403 一致', async () => {
    const cookie = (ids as any).adminCookie as string;
    const oldSession = await freshSession('parity-self');
    await request(server()).get('/api/v1/examples/items').set('Cookie', oldSession).expect(200);
    // 收回业务角色的编辑/删除授权并递增目标版本（与角色管理保存行为一致）
    await q("DELETE rm FROM role_menus rm JOIN menus m ON m.id = rm.menu_id WHERE rm.role_id = 50 AND m.permission IN ('example-items:update','example-items:delete')");
    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [ids.uSelf]);
    // 解释按当前配置：编辑权限码缺失（查看仍在）
    const data = await explain(cookie, ids.uSelf, recordIds.own);
    expect(verdictOf(data, 'detail').result).toBe('allowed');
    expect(verdictOf(data, 'update').reasonCodes).toEqual(['OPERATION_PERMISSION_MISSING']);
    expect(data.operationPermissions.find((item: any) => item.action === 'update')!.sources).toEqual([]);
    // 旧 JWT 按版本失效（不是“解释模拟旧会话”）
    await request(server()).get('/api/v1/examples/items').set('Cookie', oldSession).expect(401);
    // 全新登录：与解释一致——详情 200、编辑 403
    const fresh = await loginPost('parity-self', password);
    const newSession = cookieOf(fresh)!;
    await request(server()).get(`/api/v1/examples/items/${recordIds.own}`).set('Cookie', newSession).expect(200);
    await request(server()).put(`/api/v1/examples/items/${recordIds.own}`).set('Cookie', newSession)
      .send({ title: 'x', status: 'pending', version: 1 }).expect(403);
    // 还原授权，供后续用例
    const [menuRows] = await q("SELECT id FROM menus WHERE permission IN ('example-items:update','example-items:delete') AND deleted_at IS NULL");
    for (const menu of menuRows as any[]) {
      await q('INSERT INTO role_menus (role_id, menu_id) VALUES (50, ?)', [menu.id]);
    }
    await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [ids.uSelf]);
  });

  it('admin 例外：解释全 allowed＋ADMIN_EXCEPTION，实际含无归属记录全部 200', async () => {
    const cookie = (ids as any).adminCookie as string;
    const data = await explain(cookie, ids.uAdmin, recordIds.noOwner);
    for (const action of ['list', 'detail', 'update', 'delete', 'export']) {
      expect(verdictOf(data, action).result).toBe('allowed');
      expect(verdictOf(data, action).reasonCodes).toContain('ADMIN_EXCEPTION');
    }
    expect(data.operationPermissions.every((item: any) => item.adminException)).toBe(true);
    const session = await freshSession('parity-mini-admin');
    await request(server()).get(`/api/v1/examples/items/${recordIds.noOwner}`).set('Cookie', session).expect(200);
  });

  it('无归属与软删除（非 admin）：NO_OWNER_RECORD / RECORD_NOT_FOUND 与实际 403/404 一致', async () => {
    const cookie = (ids as any).adminCookie as string;
    const uViewSession = await freshSession('parity-view');
    // 无归属：解释 NO_OWNER_RECORD；实际——by_users 目标不含该记录且 owner 为空 → 范围 404
    const noOwner = await explain(cookie, ids.uView, recordIds.noOwner);
    // uView 的共同范围为 本人∪peerA1，无归属记录不在范围 → RECORD_NOT_FOUND 先于开关层
    expect(verdictOf(noOwner, 'detail').reasonCodes).toEqual(['RECORD_NOT_FOUND']);
    await request(server()).get(`/api/v1/examples/items/${recordIds.noOwner}`).set('Cookie', uViewSession).expect(404);
    // admin 视角（all 范围）下的无归属：NO_OWNER_RECORD
    const adminPerspective = await explain(cookie, ids.uAdmin, recordIds.noOwner);
    expect(verdictOf(adminPerspective, 'detail').reasonCodes).toContain('ADMIN_EXCEPTION');
    // 用一个 all 档非 admin 用户验证 NO_OWNER_RECORD：临时给 uDept 升 all？改为直接用解释服务内部语义——
    // 额外造一个 all 档用户
    const hash = await bcrypt.hash(password, 10);
    const [row]: any = await q('INSERT INTO users (username, display_name, password, status, token_version, role_id, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 50, NOW(6), NOW(6))', ['parity-all', 'parity-all', hash]);
    const allUserId = Number(row.insertId);
    await q('INSERT INTO user_roles (user_id, role_id, owner_id, created_by, created_at, updated_at) VALUES (?, 50, ?, ?, NOW(6), NOW(6))', [allUserId, allUserId, allUserId]);
    await q("INSERT INTO user_data_scopes (user_id, scope_key, scope_type, view_others, edit_others, delete_others, view_self, edit_self, delete_self, owner_id, created_at, updated_at) VALUES (?, 'example-items', 'all', 1, 1, 1, 1, 1, 1, ?, NOW(6), NOW(6))", [allUserId, allUserId]);
    const allData = await explain(cookie, allUserId, recordIds.noOwner);
    expect(verdictOf(allData, 'detail').reasonCodes).toEqual(['NO_OWNER_RECORD']);
    const allSession = await freshSession('parity-all');
    await request(server()).get(`/api/v1/examples/items/${recordIds.noOwner}`).set('Cookie', allSession).expect(403);

    // 软删除：admin 删除记录后，uDept 解释与实际均为不可见
    await request(server()).delete(`/api/v1/examples/items/${recordIds.peerB}`).set('Cookie', cookie).expect(200);
    const deleted = await explain(cookie, ids.uDept, recordIds.peerB);
    expect(verdictOf(deleted, 'detail').reasonCodes).toEqual(['RECORD_NOT_FOUND']);
    const deptSession = await freshSession('parity-dept');
    await request(server()).get(`/api/v1/examples/items/${recordIds.peerB}`).set('Cookie', deptSession).expect(404);
  });

  it('账号层与附件表单：待改密/禁用短路；附件记录级 unsupported；审计已记录', async () => {
    const cookie = (ids as any).adminCookie as string;
    // 待改密：管理员重置 uView → 解释 ACCOUNT_MUST_CHANGE_PASSWORD；目标登录为受限会话
    const reset = await request(server()).post(`/api/v1/users/${ids.uView}/reset-password`).set('Cookie', cookie).send({});
    expect(reset.status).toBe(201);
    const tempPassword = reset.body.data.temporaryPassword as string;
    const pending = await explain(cookie, ids.uView, recordIds.peerA1);
    expect(verdictOf(pending, 'detail').reasonCodes).toEqual(['ACCOUNT_MUST_CHANGE_PASSWORD']);
    const restricted = await loginPost('parity-view', tempPassword);
    expect(restricted.status).toBe(201);
    expect(restricted.body.data.user.mustChangePassword).toBe(true);
    await request(server()).get('/api/v1/examples/items').set('Cookie', cookieOf(restricted)!).expect(403);

    // 禁用：解释 ACCOUNT_DISABLED；目标无法登录
    await q('UPDATE users SET status = 0 WHERE id = ?', [ids.uFallback]);
    const disabled = await explain(cookie, ids.uFallback, null);
    expect(disabled.account.status).toBe(0);
    const deniedLogin = await loginPost('parity-fallback', password);
    expect(deniedLogin.status).toBe(403);

    // 附件表单：摘要可用，记录级 unsupported
    const attachments = await request(server())
      .get(`/api/v1/users/${ids.uSelf}/permission-explanation`).query({ scopeKey: 'attachments', recordId: 1 }).set('Cookie', cookie);
    expect(attachments.status).toBe(200);
    for (const item of attachments.body.data.recordEvaluation) {
      expect(item.result).toBe('unsupported');
    }

    // 管理审计：诊断请求已落库且不含业务正文
    const [logs] = await q("SELECT detail FROM system_logs WHERE detail LIKE '%permission_explain%' ORDER BY id");
    expect((logs as any[]).length).toBeGreaterThan(5);
    for (const log of logs as any[]) {
      expect(log.detail).not.toContain('本人的单据');
      expect(log.detail).not.toContain('标题');
    }
  });
});
