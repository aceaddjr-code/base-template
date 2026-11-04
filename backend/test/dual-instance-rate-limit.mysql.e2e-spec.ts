import { createConnection } from 'mysql2/promise';
import request from 'supertest';

/**
 * 双后端实例共享限流验收（任务 06 验收矩阵「并发与双实例」＋「真实代理模式」）：
 * 同一隔离库上启动两个完整 HTTP 实例；实例 B 以 TRUST_PROXY_HOPS=1 运行，
 * 用 X-Forwarded-For 模拟反向代理后的多客户端 IP，验证账号配额跨实例/跨 IP 共享、
 * IP 配额按可信客户端 IP 独立计数。
 */
const suite = process.env.TEST_DUAL_DATABASE ? describe : describe.skip;
suite('双实例共享登录限流：隔离 MySQL + 真实 HTTP', () => {
  const database = process.env.TEST_DUAL_DATABASE!;
  const accountWindowSeconds = 60;
  const accountMax = 5;
  const ipMax = 6;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let apps: import('@nestjs/common').INestApplication[] = [];
  let created = false;
  const password = 'dual-instance-only-password';

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;

    process.env.DB_DATABASE = database;
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.NODE_ENV = 'development';
    process.env.LOGIN_ACCOUNT_WINDOW_SECONDS = String(accountWindowSeconds);
    process.env.LOGIN_ACCOUNT_MAX = String(accountMax);
    process.env.LOGIN_IP_MAX = String(ipMax);
    // 环境必须在 AppModule 求值前就位（Jest VM 不支持动态 import）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApplication } = require('../src/app.setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NestFactory } = require('@nestjs/core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigService } = require('@nestjs/config');
    for (const proxied of [false, true]) {
      const app = await NestFactory.create(AppModule, { logger: false });
      configureApplication(app, app.get(ConfigService));
      // 同进程双实例共享同一 ConfigService 快照；实例 B 在装配后显式启用一跳代理模式，
      // 与部署时 TRUST_PROXY_HOPS=1 的效果一致（trust-proxy.spec 已验证配置路径本身）
      if (proxied) app.set('trust proxy', 1);
      await app.init();
      apps.push(app);
    }
    // 虚构账号：登录入口对未知账号同样计数（等成本校验）
  }, 120000);

  afterAll(async () => {
    for (const app of apps) await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.LOGIN_ACCOUNT_WINDOW_SECONDS;
    delete process.env.LOGIN_ACCOUNT_MAX;
    delete process.env.LOGIN_IP_MAX;
    delete process.env.TRUST_PROXY_HOPS;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });
  it('账号配额跨实例共享：A 用尽后 B 拒绝；IP 配额按可信客户端 IP 独立', async () => {
    const direct = apps[0].getHttpServer();
    const proxied = apps[1].getHttpServer();
    const loginid = 'dual-ghost-user';

    // 实例 A（直连）消耗同一未知账号的全部配额
    for (let i = 0; i < accountMax; i++) {
      const response = await request(direct).post('/api/v1/auth/login').send({ loginid, password });
      expect(response.status).toBe(401); // 未知账号：统一凭据错误
    }
    // 实例 B（代理模式、不同客户端 IP）第 accountMax+1 次被账号窗口拒绝：
    // 同账号跨 IP 共用配额；换 IP 不能绕过
    const blocked = await request(proxied).post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.10').send({ loginid, password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('LOGIN_RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    // IP 配额按可信客户端 IP 独立：两个不同 XFF 客户端各有 ipMax 份额，
    // 互不挤占（各用 ipMax 次后下一个不同账号同 IP 被拒）
    for (let i = 0; i < ipMax; i++) {
      await request(proxied).post('/api/v1/auth/login')
        .set('X-Forwarded-For', '198.51.100.11').send({ loginid: `ip-a-user-${i}`, password });
    }
    const ipAExhausted = await request(proxied).post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.11').send({ loginid: 'ip-a-next-user', password });
    expect(ipAExhausted.status).toBe(429);
    const ipBStillFine = await request(proxied).post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.12').send({ loginid: 'ip-b-user', password });
    expect(ipBStillFine.status).toBe(401); // IP 桶独立：未被 11 号 IP 挤占，仍走到统一凭据错误

    // 计数表证据：桶键按可信客户端 IP 与账号分别落库
    const [buckets] = await admin.query(`SELECT bucket_key FROM \`${database}\`.login_attempt_counters ORDER BY bucket_key`);
    const keys = (buckets as any[]).map((r) => r.bucket_key as string);
    expect(keys.some((k) => k.startsWith('acct:pending:'))).toBe(true);
    expect(keys.filter((k) => k.startsWith('ip:198.51.100.1')).length).toBeGreaterThanOrEqual(2);
    expect(keys.some((k) => k === 'ip:127.0.0.1' || k === 'ip:::ffff:127.0.0.1')).toBe(true);
  });
});
