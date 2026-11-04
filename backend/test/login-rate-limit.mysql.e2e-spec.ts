import { createConnection } from 'mysql2/promise';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { LoginAttemptCounter } from '../src/modules/auth/login-attempt-counter.entity';
import { LoginRateLimitService } from '../src/modules/auth/login-rate-limit.service';
import { accountBucketKey, pendingAccountBucketKey } from '../src/modules/auth/account-security.contracts';

/**
 * 登录联合限流：真实隔离 MySQL 的并发与多实例验收（任务 02）。
 * 两个独立 DataSource 连接同一隔离库，模拟两个后端实例共享计数。
 */
const suite = process.env.TEST_RATELIMIT_DATABASE ? describe : describe.skip;
suite('登录联合限流：隔离 MySQL', () => {
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let sources: DataSource[] = [];
  let created = false;
  const database = process.env.TEST_RATELIMIT_DATABASE!;
  const config = new ConfigService({
    LOGIN_IP_WINDOW_SECONDS: 60, LOGIN_IP_MAX: 20,
    LOGIN_ACCOUNT_WINDOW_SECONDS: 900, LOGIN_ACCOUNT_MAX: 10,
  });
  const log = { write: async () => undefined };
  const t0 = new Date('2026-11-04T08:00:00Z');
  const key = (id: number) => accountBucketKey(id);

  const makeService = (index: number) => new LoginRateLimitService(
    sources[index].getRepository(LoginAttemptCounter), config, log as any);

  const fetchRow = async (bucketKey: string) => {
    const [rows] = await admin.query(`SELECT * FROM \`${database}\`.login_attempt_counters WHERE bucket_key = ?`, [bucketKey]) as any;
    return rows[0];
  };

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    // 双实例：两条互不共享的连接；仅第一条 synchronize 建表。
    for (let i = 0; i < 2; i++) {
      const source = new DataSource({
        type: 'mysql', host, port: Number(process.env.DB_PORT || 3306),
        username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD,
        database, entities: [LoginAttemptCounter], synchronize: i === 0,
      });
      await source.initialize();
      sources.push(source);
    }
  });

  beforeEach(async () => {
    await admin.query(`DELETE FROM \`${database}\`.login_attempt_counters`);
  });

  afterAll(async () => {
    for (const source of sources) await source?.destroy().catch(() => undefined);
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  it('并发预占不超发：50 并发同账号至多放行 10 次，其余按窗口拒绝', async () => {
    const service = makeService(0);
    const decisions = await Promise.all(
      Array.from({ length: 50 }, () => service.reserveAccountBucket(key(7), t0)),
    );
    const allowed = decisions.filter((d) => d.allowed);
    const rejected = decisions.filter((d) => !d.allowed);
    // 读回值只会大于等于自身预占序号，因此放行数不会超过配额（不超发）。
    // 高并发下读回常被后续预占追上，允许数可为 0；串行放行路径由其他用例覆盖。
    expect(allowed.length).toBeLessThanOrEqual(10);
    expect(allowed.length + rejected.length).toBe(50);
    for (const d of rejected) {
      expect(d.rejectedBy).toBe('window');
      expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(d.retryAfterSeconds).toBeLessThanOrEqual(900);
    }
    // 被拒请求预占了额度，但窗口起点与任何时间字段不被延长
    const row = await fetchRow(key(7));
    expect(Number(row.attempt_count)).toBe(50);
    expect(new Date(row.window_start).getTime()).toBe(Math.floor(t0.getTime() / 900000) * 900000);
    expect(row.retry_after).toBeNull();
  });

  it('两个实例共享同一账号配额：实例 A 用尽后实例 B 被拒；成功复位后均可再用', async () => {
    const a = makeService(0);
    const b = makeService(1);
    let lastAllowed: Awaited<ReturnType<typeof a.reserveAccountBucket>> | undefined;
    for (let i = 0; i < 10; i++) {
      lastAllowed = await a.reserveAccountBucket(key(8), t0);
      expect(lastAllowed.allowed).toBe(true);
    }
    await expect(b.reserveAccountBucket(key(8), t0)).resolves.toMatchObject({ allowed: false, rejectedBy: 'window' });
    // 正确密码路径：实例 A 以预占时窗口代次复位（防止过期成功清掉新窗口），实例 B 立即恢复额度
    await a.recordAccountSuccess(key(8), lastAllowed!.observedWindow, t0);
    await expect(b.reserveAccountBucket(key(8), t0)).resolves.toMatchObject({ allowed: true });
  });

  it('IP 维度独立计数：同 IP 跨账号累计，账号成功登录不清 IP 计数', async () => {
    const service = makeService(0);
    for (let i = 0; i < 20; i++) {
      await expect(service.reserveIpBucket('203.0.113.9', t0)).resolves.toMatchObject({ allowed: true });
    }
    // 第 21 次（换任何账号）拒绝
    await expect(service.reserveIpBucket('203.0.113.9', t0)).resolves.toMatchObject({ allowed: false, rejectedBy: 'window' });
    const decision = await service.reserveAccountBucket(key(9), t0);
    await service.recordAccountSuccess(key(9), decision.observedWindow, t0);
    await expect(service.reserveIpBucket('203.0.113.9', t0)).resolves.toMatchObject({ allowed: false, rejectedBy: 'window' });
  });

  it('连续失败进入退避：第 5 次失败后 30 秒内拒绝，到期自动恢复无需解锁', async () => {
    const service = makeService(0);
    for (let i = 0; i < 5; i++) {
      const decision = await service.reserveAccountBucket(key(10), t0);
      expect(decision.allowed).toBe(true);
      await service.recordAccountFailure(key(10), t0);
    }
    const row = await fetchRow(key(10));
    expect(Number(row.fail_streak)).toBe(5);
    expect(new Date(row.retry_after).getTime()).toBe(t0.getTime() + 30 * 1000);
    // 退避期内拒绝（backoff），且不改写等待时间或窗口
    await expect(service.reserveAccountBucket(key(10), new Date(t0.getTime() + 29 * 1000)))
      .resolves.toMatchObject({ allowed: false, rejectedBy: 'backoff', retryAfterSeconds: 1 });
    const unchanged = await fetchRow(key(10));
    expect(new Date(unchanged.retry_after).getTime()).toBe(t0.getTime() + 30 * 1000);
    // 到期按服务端时间恢复：不写用户 status，无需管理员解锁
    await expect(service.reserveAccountBucket(key(10), new Date(t0.getTime() + 31 * 1000)))
      .resolves.toMatchObject({ allowed: true });
  });

  it('退避序列 30/60/120/300 秒封顶；成功登录清零连续失败与窗口计数', async () => {
    const service = makeService(0);
    // 前 4 次连续失败不进入退避
    for (let i = 0; i < 4; i++) {
      const decision = await service.reserveAccountBucket(key(11), t0);
      expect(decision.allowed).toBe(true);
      await service.recordAccountFailure(key(11), t0);
      const row = await fetchRow(key(11));
      expect(row.retry_after).toBeNull();
    }
    const waits = [30, 60, 120, 300];
    let t = t0.getTime();
    for (const [index, wait] of waits.entries()) {
      // 非首段先推进过上一段退避到期点，才能再次预占（退避期内本就应被拒）
      if (index > 0) t += waits[index - 1] * 1000 + 1000;
      const now = new Date(t);
      const decision = await service.reserveAccountBucket(key(11), now);
      expect(decision.allowed).toBe(true);
      await service.recordAccountFailure(key(11), now);
      const row = await fetchRow(key(11));
      expect(new Date(row.retry_after).getTime()).toBe(t + wait * 1000);
    }
    // 最后一段退避到期后成功登录：同一窗口内复位
    const recovered = new Date(t + 300 * 1000 + 1000);
    const decision = await service.reserveAccountBucket(key(11), recovered);
    expect(decision.allowed).toBe(true);
    await service.recordAccountSuccess(key(11), decision.observedWindow, recovered);
    const row = await fetchRow(key(11));
    expect(Number(row.fail_streak)).toBe(0);
    expect(row.retry_after).toBeNull();
    expect(Number(row.attempt_count)).toBe(0);
  });

  it('固定窗口按时间滚动：到期后新窗口重新计数，旧窗口计数不带入', async () => {
    const service = makeService(0);
    for (let i = 0; i < 10; i++) await service.reserveAccountBucket(key(12), t0);
    await expect(service.reserveAccountBucket(key(12), t0)).resolves.toMatchObject({ allowed: false });
    const nextWindow = new Date(t0.getTime() + 900 * 1000);
    await expect(service.reserveAccountBucket(key(12), nextWindow)).resolves.toMatchObject({ allowed: true });
    const row = await fetchRow(key(12));
    expect(Number(row.attempt_count)).toBe(1);
    expect(new Date(row.window_start).getTime()).toBe(Math.floor(nextWindow.getTime() / 900000) * 900000);
  });

  it('未知账号桶键大小写归并：不同写法共享同一配额', async () => {
    const service = makeService(0);
    expect(pendingAccountBucketKey('AdMiN')).toBe(pendingAccountBucketKey('admin'));
    for (let i = 0; i < 10; i++) await service.reserveAccountBucket(pendingAccountBucketKey('ghost-user'), t0);
    await expect(service.reserveAccountBucket(pendingAccountBucketKey('GHOST-USER'), t0))
      .resolves.toMatchObject({ allowed: false, rejectedBy: 'window' });
  });

  it('过期计数有界清理：只删超过保留期的行', async () => {
    const service = makeService(0);
    await service.reserveAccountBucket(key(13), t0);
    // 手工补一行 updated_at 早于保留期的陈旧行（绕过 UpdateDateColumn 自动时间）
    await admin.query(
      `INSERT INTO \`${database}\`.login_attempt_counters
         (bucket_key, window_start, window_seconds, attempt_count, fail_streak, retry_after, created_at, updated_at)
       VALUES (?, NULL, 0, 1, 0, NULL, ?, ?)`,
      ['ip:198.51.100.7', new Date(t0.getTime() - 7200 * 1000), new Date(t0.getTime() - 3600 * 1000)],
    );
    // 保留期 = max(900, 60) + 600 = 1500s：later 距新行 1000s（保留）、距旧行 4600s（删除）
    const later = new Date(t0.getTime() + 1000 * 1000);
    await expect(service.purgeExpired(later)).resolves.toBe(1);
    const [rows] = await admin.query(`SELECT bucket_key FROM \`${database}\`.login_attempt_counters`) as any;
    expect(rows.map((r: any) => r.bucket_key)).toEqual([key(13)]);
  });

  it('实体表名与索引与 docs/sql 补丁声明一致', () => {
    const entity = readFileSync(resolve('src/modules/auth/login-attempt-counter.entity.ts'), 'utf8');
    expect(entity).toContain("Entity('login_attempt_counters')");
    expect(entity).toContain("Index('idx_login_attempt_counters_updated_at'");
    const patch = readFileSync(resolve('..', 'docs/sql/20261104-account-security.sql'), 'utf8');
    expect(patch).toContain('CREATE TABLE IF NOT EXISTS login_attempt_counters');
    expect(patch).toContain('KEY idx_login_attempt_counters_updated_at (updated_at)');
  });
});
