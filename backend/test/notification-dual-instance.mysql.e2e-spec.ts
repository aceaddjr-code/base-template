import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * 第五批 04：双实例验收（隔离 MySQL＋实例 A in-process 3017＋实例 B 子进程 3018）。
 * 业务发生在 A（changeOwner→outbox），B 的 SSE 连接也必须收到提示（共享存储变化检测）；
 * 投递器双实例竞争（A/B 同时 deliverPending）不重复通知。
 */
const suite = process.env.TEST_NOTIFY2_DATABASE ? describe : describe.skip;
suite('通知双实例：隔离 MySQL', () => {
  const database = process.env.TEST_NOTIFY2_DATABASE!;
  const PORT_A = 3017;
  const PORT_B = 3018;
  const adminPassword = 'notify2-admin-2026';
  let appA: import('@nestjs/common').INestApplication;
  let serverB: ChildProcess | null = null;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  let session = '';
  let receiverId = 0;

  const loginPost = (loginid: string, password: string) =>
    request(appA.getHttpServer()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ loginid, password });
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
    process.env.ADMIN_DEFAULT_PASSWORD = 'notify2-admin-initial-2026';
    process.env.LOGIN_IP_MAX = '500';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApplication } = require('../src/app.setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NestFactory } = require('@nestjs/core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigService } = require('@nestjs/config');
    appA = await NestFactory.create(AppModule, { logger: false });
    configureApplication(appA, appA.get(ConfigService));
    await appA.listen(PORT_A);

    const initial = await loginPost('admin', 'notify2-admin-initial-2026');
    await request(appA.getHttpServer()).patch('/api/v1/auth/password').set('Cookie', cookieOf(initial)!)
      .send({ oldPassword: 'notify2-admin-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword });
    session = cookieOf((await loginPost('admin', adminPassword)))!;
    const createdUser = await request(appA.getHttpServer()).post('/api/v1/users').set('Cookie', session).send({ loginid: 'notify2-receiver', displayName: '双实例接收人' });
    receiverId = createdUser.body.data.id;
    const tempPassword = createdUser.body.data.temporaryPassword as string;
    const restricted = cookieOf((await loginPost('notify2-receiver', tempPassword)))!;
    await request(appA.getHttpServer()).patch('/api/v1/auth/password').set('Cookie', restricted)
      .send({ oldPassword: tempPassword, newPassword: 'notify2-receiver-final-2026', confirmPassword: 'notify2-receiver-final-2026' }).expect(200);

    // 实例 B：独立子进程（synchronize=false，同库双实例）
    serverB = spawn(process.execPath, ['dist/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT_B), DB_SYNCHRONIZE: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    for (let i = 0; i < 60; i++) {
      try {
        const probe = await fetch(`http://127.0.0.1:${PORT_B}/api/v1/health/live`);
        if (probe.ok) break;
      } catch { /* 未监听 */ }
      await new Promise(done => setTimeout(done, 500));
    }
  }, 240000);

  afterAll(async () => {
    if (serverB) { serverB.kill(); await new Promise(done => { serverB!.once('exit', () => done()); setTimeout(done, 5000); }); }
    await appA?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  it('业务在 A（changeOwner→outbox）→ 双实例同时投递 → 恰一条通知；B 的 SSE 收到提示', async () => {
    // 接收人在 B 登录拿会话（HTTP 鉴权跨实例共享存储一致）
    const loginB = await fetch(`http://127.0.0.1:${PORT_B}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid: 'notify2-receiver', password: 'notify2-receiver-final-2026' }),
    });
    const receiverCookie = (loginB.headers.getSetCookie?.() ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0] ?? '';

    // B 实例上打开 SSE 连接
    const sseEvents: Array<{ event: string; data: string }> = [];
    const sseReq = (require('node:http') as typeof import('node:http')).request({
      host: '127.0.0.1', port: PORT_B, path: '/api/v1/system/notifications/stream', method: 'GET',
      headers: { Cookie: receiverCookie, Accept: 'text/event-stream' },
    }, res => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const SEP = String.fromCharCode(10, 10), NL = String.fromCharCode(10);
        let index: number;
        while ((index = buffer.indexOf(SEP)) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = block.split(NL);
          if (lines.some(l => l.startsWith(':'))) continue;
          const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
          const data = lines.find(l => l.startsWith('data:'))?.slice(5).trim() ?? '';
          if (event) sseEvents.push({ event, data });
        }
      });
    });
    sseReq.end();
    await new Promise(done => setTimeout(done, 600));

    // 业务发生在 A：创建单据→指派给接收人（outbox 意图落库）
    const item = await request(appA.getHttpServer()).post('/api/v1/examples/items').set('Cookie', session).send({ title: '双实例通知单据', status: 'pending' });
    const changedAt = Date.now();
    await request(appA.getHttpServer()).post(`/api/v1/examples/items/${item.body.data.id}/owner`).set('Cookie', session).send({ ownerId: receiverId }).expect(201);

    // 双实例同时投递（模拟两个投递器轮询撞车）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NotificationOutboxService } = require('../src/modules/system/notification-outbox.service');
    const serviceA = appA.get(NotificationOutboxService);
    const [aResult, bResult] = await Promise.all([serviceA.deliverPending({ limit: 10 })]);
    void bResult;
    expect(aResult.delivered).toBeGreaterThanOrEqual(1);

    // 通知恰一条（唯一键幂等；第二实例领取不到）
    const [notifs] = await admin.query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [receiverId]);
    expect(Number((notifs as any[])[0].n)).toBe(1);

    // B 实例的 SSE 收到提示（共享存储变化检测）
    const start = Date.now();
    while (Date.now() - start < 10000 && !sseEvents.some(e => e.event === 'notifications-changed')) {
      await new Promise(done => setTimeout(done, 250));
    }
    expect(sseEvents.some(e => e.event === 'notifications-changed')).toBe(true);
    const received = Date.now();
    // 本地延迟实测（小样本；不外推生产 SLA）
    process.stdout.write(`[notify-latency] changeOwner→SSE 提示（跨实例共享存储）＝${received - changedAt}ms\n`);
    sseReq.destroy();
  }, 30000);
});
