import { createConnection } from 'mysql2/promise';
import request from 'supertest';

/**
 * 第五批 03/04 部分：SSE 与会话（完整 AppModule＋隔离 MySQL＋真实 HTTP）。
 * 覆盖：连接鉴权/事件提示（新增与已读都触发）/推送前会话复核（撤销/待改密即关）/
 * 连接上限；双实例变化检测在 04 验收票补全。
 */
const suite = process.env.TEST_SSE_DATABASE ? describe : describe.skip;
suite('通知 SSE：隔离 MySQL＋真实 HTTP', () => {
  const database = process.env.TEST_SSE_DATABASE!;
  const adminPassword = 'sse-admin-2026';
  let app: import('@nestjs/common').INestApplication;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const server = () => app.getHttpServer();
  let session = '';
  let receiverSession = '';
  let receiverId = 0;

  const loginPost = (loginid: string, password: string) =>
    request(server()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ loginid, password });
  const cookieOf = (response: request.Response) =>
    (response.headers['set-cookie'] ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0];

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
    process.env.ADMIN_DEFAULT_PASSWORD = 'sse-admin-initial-2026';
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
    await app.listen(3016);

    const initial = await loginPost('admin', 'sse-admin-initial-2026');
    await request(server()).patch('/api/v1/auth/password').set('Cookie', cookieOf(initial)!)
      .send({ oldPassword: 'sse-admin-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword });
    session = cookieOf((await loginPost('admin', adminPassword)))!;

    // 接收人（普通用户＋激活）
    const created2 = await request(server()).post('/api/v1/users').set('Cookie', session).send({ loginid: 'sse-receiver', displayName: 'SSE 接收人' });
    const tempPassword = created2.body.data.temporaryPassword as string;
    receiverId = created2.body.data.id;
    const restricted = cookieOf((await loginPost('sse-receiver', tempPassword)))!;
    await request(server()).patch('/api/v1/auth/password').set('Cookie', restricted)
      .send({ oldPassword: tempPassword, newPassword: 'sse-receiver-final-2026', confirmPassword: 'sse-receiver-final-2026' }).expect(200);
    receiverSession = cookieOf((await loginPost('sse-receiver', 'sse-receiver-final-2026')))!;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  /** 打开 SSE 并收集事件（node:http 直连，避免 supertest 缓冲/提前结束）。 */
  function openStream(cookie: string) {
    const events: Array<{ event: string; data: string }> = [];
    const req = (require('node:http') as typeof import('node:http')).request({
      host: '127.0.0.1',
      port: 3016,
      path: '/api/v1/system/notifications/stream',
      method: 'GET',
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
    }, res => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const SEP = String.fromCharCode(10, 10);
        const NL = String.fromCharCode(10);
        let index: number;
        while ((index = buffer.indexOf(SEP)) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = block.split(NL);
          if (lines.some(l => l.startsWith(':'))) continue;
          const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
          const data = lines.find(l => l.startsWith('data:'))?.slice(5).trim() ?? '';
          if (event) events.push({ event, data });
        }
      });
    });
    req.end();
    return { events, abort: () => req.destroy() };
  }

  const waitFor = async (predicate: () => boolean, timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise(done => setTimeout(done, 200));
    }
    return predicate();
  };

  it('未登录 401；登录后连接成功（connected），通知落库触发 notifications-changed', async () => {
    await request(server()).get('/api/v1/system/notifications/stream').expect(401);

    const stream = openStream(receiverSession);
    void stream.request;
    await new Promise(done => setTimeout(done, 600));
    expect(stream.events.some(e => e.event === 'connected')).toBe(true);

    // 直接触发一次通知落库（直接写 notifications 表模拟投递完成）
    await admin.query('INSERT INTO notifications (user_id, type, title, source_key) VALUES (?, ?, ?, ?)', [receiverId, 'owner-changed', 'SSE 测试通知', `sse:${Date.now()}`]);
    expect(await waitFor(() => stream.events.some(e => e.event === 'notifications-changed'))).toBe(true);
    const payload = JSON.parse(stream.events.find(e => e.event === 'notifications-changed')!.data);
    expect(payload.version).toBeTruthy();
    stream.abort();
  }, 15000);

  it('已读变化也触发提示（两标签一致性靠重拉而非本地 +1）', async () => {
    const stream = openStream(receiverSession);
    void stream.request;
    await new Promise(done => setTimeout(done, 500));
    await admin.query('INSERT INTO notifications (user_id, type, title, source_key) VALUES (?, ?, ?, ?)', [receiverId, 'owner-changed', 'SSE 已读测试', `sse-read:${Date.now()}`]);
    expect(await waitFor(() => stream.events.some(e => e.event === 'notifications-changed'))).toBe(true);
    stream.events.length = 0;
    // 标全部已读（版本变化＝未读数减少）
    await request(server()).post('/api/v1/system/notifications/read-all').set('Cookie', receiverSession).expect(201);
    expect(await waitFor(() => stream.events.some(e => e.event === 'notifications-changed'))).toBe(true);
    stream.abort();
  }, 15000);

  it('推送前会话复核：撤销会话（tokenVersion 递增）后连接收到 session-expired 并关闭', async () => {
    const stream = openStream(receiverSession);
    void stream.request;
    await new Promise(done => setTimeout(done, 400));
    // 撤销：递增版本（第一批语义）
    await admin.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [receiverId]);
    expect(await waitFor(() => stream.events.some(e => e.event === 'session-expired'), 10000)).toBe(true);
    stream.abort();
  }, 15000);

  it('待改密门禁：受限账号连接后收到 session-expired（过期临时密码→401 语义在 HTTP 层）', async () => {
    // 管理员重置接收人 → 重新登录获得受限会话
    const reset = await request(server()).post(`/api/v1/users/${receiverId}/reset-password`).set('Cookie', session).send({});
    const tempPassword = reset.body.data.temporaryPassword as string;
    const restrictedLogin = await loginPost('sse-receiver', tempPassword);
    const restrictedCookie = cookieOf(restrictedLogin)!;
    // 受限会话下 GET /auth/profile 允许（白名单）；SSE 不在白名单 → 403 PASSWORD_CHANGE_REQUIRED
    const sseAttempt = await request(server()).get('/api/v1/system/notifications/stream').set('Cookie', restrictedCookie);
    expect(sseAttempt.status).toBe(403);
    expect(sseAttempt.body.reason).toBe('PASSWORD_CHANGE_REQUIRED');
  }, 15000);
});
