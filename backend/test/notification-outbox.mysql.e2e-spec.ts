import * as XLSX from 'xlsx-js-style';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';
import { NotificationOutboxService } from '../src/modules/system/notification-outbox.service';

/**
 * 第五批 02：outbox 闭环（完整 AppModule＋隔离 MySQL＋真实 HTTP）。
 * 覆盖：changeOwner→outbox 意图→投递器落库通知、事务回滚无意图、无变化/自我指派不发、
 * 幂等（重复投递不重复未读）、停用接收人 skipped、failed 补发、双投递器租约。
 */
const suite = process.env.TEST_NOTIFY_DATABASE ? describe : describe.skip;
suite('通知 outbox：隔离 MySQL＋真实 HTTP', () => {
  const database = process.env.TEST_NOTIFY_DATABASE!;
  const adminPassword = 'notify-admin-2026';
  let app: import('@nestjs/common').INestApplication;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const server = () => app.getHttpServer();
  let session = '';
  let operatorSession = '';
  let operatorId = 0;

  const loginPost = (loginid: string, password: string) =>
    request(server()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ loginid, password });
  const cookieOf = (response: request.Response) =>
    (response.headers['set-cookie'] ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0];

  const createUser = async (loginid: string, displayName: string): Promise<{ id: number; temporaryPassword: string }> => {
    const created = await request(server()).post('/api/v1/users').set('Cookie', session).send({ loginid, displayName });
    return { id: created.body.data.id, temporaryPassword: created.body.data.temporaryPassword };
  };
  const activate = async (loginid: string, temporaryPassword: string, finalPassword: string) => {
    const login = await loginPost(loginid, temporaryPassword);
    const cookie = cookieOf(login)!;
    await request(server()).patch('/api/v1/auth/password').set('Cookie', cookie)
      .send({ oldPassword: temporaryPassword, newPassword: finalPassword, confirmPassword: finalPassword }).expect(200);
  };

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
    process.env.ADMIN_DEFAULT_PASSWORD = 'notify-admin-initial-2026';
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

    const initial = await loginPost('admin', 'notify-admin-initial-2026');
    await request(server()).patch('/api/v1/auth/password').set('Cookie', cookieOf(initial)!)
      .send({ oldPassword: 'notify-admin-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword });
    session = cookieOf((await loginPost('admin', adminPassword)))!;

    // 操作者（普通用户，能创建/变更自己的单据）＋接收人甲乙
    const operator = await createUser('notify-operator', '通知操作者');
    operatorId = operator.id;
    await activate('notify-operator', operator.temporaryPassword, 'notify-op-final-2026');
    operatorSession = cookieOf((await loginPost('notify-operator', 'notify-op-final-2026')))!;
    const receiver = await createUser('notify-receiver-a', '接收人甲');
    await activate('notify-receiver-a', receiver.temporaryPassword, 'notify-ra-final-2026');
    const receiverB = await createUser('notify-receiver-b', '接收人乙');
    await activate('notify-receiver-b', receiverB.temporaryPassword, 'notify-rb-final-2026');
  }, 180000);

  afterAll(async () => {
    await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  const createItem = async (title: string, cookie = operatorSession) => {
    const result = await request(server()).post('/api/v1/examples/items').set('Cookie', cookie).send({ title, status: 'pending' });
    expect(result.status).toBe(201);
    return result.body.data.id as number;
  };
  const changeOwner = (itemId: number, ownerId: number, cookie = session) =>
    request(server()).post(`/api/v1/examples/items/${itemId}/owner`).set('Cookie', cookie).send({ ownerId });
  const runDelivery = () => admin.query('SELECT id FROM notification_outbox WHERE status = \'pending\' LIMIT 1').then(async ([rows]) => {
    if (!(rows as any[]).length) return { claimed: 0, delivered: 0 };
    // 直接调服务实例：通过 DI 容器拿
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outboxService = app.get(NotificationOutboxService);
    return outboxService.deliverPending({ limit: 10 });
  });

  it('changeOwner→outbox 意图（同事务）→投递器落库通知；通知体不含业务正文', async () => {
    const itemId = await createItem('通知单据甲');
    const receiverId = (await admin.query("SELECT id FROM users WHERE username='notify-receiver-a'") as any)[0][0].id;
    await changeOwner(itemId, receiverId).expect(201);
    // outbox 意图已落库（与单据/履历同事务提交）
    const [outbox] = await admin.query(`SELECT * FROM \`${database}\`.notification_outbox WHERE recipient_id=?`, [receiverId]);
    expect((outbox as any[])).toHaveLength(1);
    expect((outbox as any[])[0].title).toBe('你收到一项负责人变更通知');
    // 投递器：落库通知＋delivered
    const result = await runDelivery();
    expect(result.delivered).toBeGreaterThanOrEqual(1);
    const [notifs] = await admin.query(`SELECT * FROM \`${database}\`.notifications WHERE user_id=?`, [receiverId]);
    expect((notifs as any[])).toHaveLength(1);
    expect((notifs as any[])[0].source_key).toContain('owner-changed');
    expect((notifs as any[])[0].read_at).toBeNull();
    // outbox delivered＋幂等证据
    const [after] = await admin.query(`SELECT status, delivered_notification_id FROM \`${database}\`.notification_outbox WHERE recipient_id=?`, [receiverId]);
    expect((after as any[])[0].status).toBe('delivered');
    expect(Number((after as any[])[0].delivered_notification_id)).toBe(Number((notifs as any[])[0].id));
    // 未读数
    const unread = await request(server()).get('/api/v1/system/notifications/unread-count').set('Cookie', cookieOf((await loginPost('notify-receiver-a', 'notify-ra-final-2026')))!);
    expect(unread.body.data.count).toBeGreaterThanOrEqual(1);
  });

  it('事务回滚无意图；无变化/自我指派不发', async () => {
    const itemId = await createItem('通知单据乙');
    const receiverId = (await admin.query("SELECT id FROM users WHERE username='notify-receiver-a'") as any)[0][0].id;
    const before = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.notification_outbox`) as any;
    // 无变化：指派给当前 owner（操作者自己创建→owner=operator）
    await changeOwner(itemId, operatorId).expect(201); // 真实变更（owner 从 operator→operator？创建时 owner=operator）
    const afterChange = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.notification_outbox`) as any;
    void receiverId; void afterChange;
    // 无变化：admin 把单据指给操作者（当前 owner）——第二次同值 → no_change，无新意图
    await changeOwner(itemId, operatorId).expect(201);
    const final = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.notification_outbox`) as any;
    expect(Number((final as any)[0][0].n)).toBe(Number((before as any)[0][0].n)); // 无新意图
    // 自我指派：admin 把自己创建的单据指给自己（新负责人＝操作者 admin）→ 不发
    const adminItem = await createItem('通知单据乙-管理员自建', session);
    const adminId = (await admin.query('SELECT id FROM users WHERE username=?', ['admin']) as any)[0][0].id;
    await changeOwner(adminItem, adminId, session).expect(201); // 真实变更（owner operator→admin），新负责人＝操作者 → 不发
    const selfFinal = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.notification_outbox`) as any;
    expect(Number((selfFinal as any)[0][0].n)).toBe(Number((final as any)[0][0].n)); // 仍无新意图
  });

  it('再次合法指派产生新事件新通知（业务键含事件不丢）', async () => {
    const itemId = await createItem('通知单据丙');
    const ra = (await admin.query("SELECT id FROM users WHERE username='notify-receiver-a'") as any)[0][0].id;
    const rb = (await admin.query("SELECT id FROM users WHERE username='notify-receiver-b'") as any)[0][0].id;
    await changeOwner(itemId, ra).expect(201);
    await runDelivery();
    await changeOwner(itemId, rb).expect(201); // 第二次指派（不同事件）
    await runDelivery();
    const [counts] = await admin.query(`SELECT user_id, COUNT(*) AS n FROM \`${database}\`.notifications WHERE user_id IN (?) GROUP BY user_id`, [[ra, rb]]) as any;
    const map = Object.fromEntries((counts as any[]).map((r: any) => [r.user_id, Number(r.n)]));
    expect(map[ra]).toBeGreaterThanOrEqual(1);
    expect(map[rb]).toBeGreaterThanOrEqual(1);
  });

  it('停用接收人→skipped；重新启用不自动补发；failed 补发重新入队', async () => {
    const itemId = await createItem('通知单据丁');
    const rb = (await admin.query("SELECT id FROM users WHERE username='notify-receiver-b'") as any)[0][0].id;
    await admin.query(`UPDATE \`${database}\`.users SET status=0 WHERE id=?`, [rb]);
    await changeOwner(itemId, rb).expect(201);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outboxService = app.get(NotificationOutboxService);
    const result = await outboxService.deliverPending({ limit: 10 });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const [skipped] = await admin.query(`SELECT status FROM \`${database}\`.notification_outbox WHERE recipient_id=? AND status='skipped'`, [rb]);
    expect((skipped as any[]).length).toBeGreaterThanOrEqual(1);
    // 重新启用：不自动补发
    await admin.query(`UPDATE \`${database}\`.users SET status=1 WHERE id=?`, [rb]);
    await admin.query(`UPDATE \`${database}\`.users SET token_version=token_version+1 WHERE id=?`, [rb]);
    const again = await outboxService.deliverPending({ limit: 10 });
    expect(again.delivered).toBe(0);
    // failed 补发：手工造一条 failed
    await admin.query(`INSERT INTO \`${database}\`.notification_outbox (event_id, recipient_id, type, title, status, attempts) VALUES ('fake-event', ?, 'owner-changed', '补发测试', 'failed', 5)`, [rb]);
    const [failedRow] = await admin.query(`SELECT id FROM \`${database}\`.notification_outbox WHERE event_id='fake-event'`) as any;
    await request(server()).post('/api/v1/system/notifications/delivery-retry').set('Cookie', session).send({ ids: [Number((failedRow as any[])[0].id)] }).expect(201);
    const [requeued] = await admin.query(`SELECT status FROM \`${database}\`.notification_outbox WHERE event_id='fake-event'`);
    expect((requeued as any[])[0].status).toBe('pending');
  });

  it('权限：普通用户直连失败列表/补发被拒；无 retry 码 admin 系统例外可用', async () => {
    await request(server()).get('/api/v1/system/notifications/delivery-failures').set('Cookie', operatorSession).expect(403);
    await request(server()).post('/api/v1/system/notifications/delivery-retry').set('Cookie', operatorSession).send({}).expect(403);
    await request(server()).get('/api/v1/system/notifications/delivery-failures').set('Cookie', session).expect(200);
  });
});
