import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginRateLimitService } from './login-rate-limit.service';
import { ACCOUNT_SECURITY_REASONS, ipBucketKey, accountBucketKey, pendingAccountBucketKey } from './account-security.contracts';

/** 按语句特征脚本化假仓储：INSERT=预占、SELECT=读回、UPDATE=写回、DELETE=清理。 */
function makeRepo() {
  const state = { row: null as any, updateSql: [] as string[], failParams: [] as any[] };
  const repo: any = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      if (sql.startsWith('INSERT')) return [];
      if (sql.startsWith('SELECT')) return state.row ? [state.row] : [];
      if (sql.startsWith('UPDATE')) {
        state.updateSql.push(sql);
        if (sql.includes('fail_streak = fail_streak + 1')) state.failParams.push(params);
        return { affectedRows: 1 };
      }
      if (sql.startsWith('DELETE')) return { affectedRows: 0 };
      throw new Error('未识别的语句');
    }),
    state,
  };
  return repo;
}

function makeService(repo: any, log?: any) {
  const config = new ConfigService({
    LOGIN_IP_WINDOW_SECONDS: 60, LOGIN_IP_MAX: 20,
    LOGIN_ACCOUNT_WINDOW_SECONDS: 900, LOGIN_ACCOUNT_MAX: 10,
  });
  const logService = log ?? { write: jest.fn().mockResolvedValue(undefined) };
  return { service: new LoginRateLimitService(repo, config, logService as any), logService };
}

describe('登录联合限流：纯逻辑与语句参数', () => {
  const now = new Date('2026-11-04T08:00:00Z');
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);

  it('窗口内未超限放行并返回窗口代次', async () => {
    const repo = makeRepo();
    repo.state.row = { window_start: windowStart, attempt_count: 20, fail_streak: 0, retry_after: null };
    const { service } = makeService(repo);
    await expect(service.reserveIpBucket('1.2.3.4', now)).resolves.toEqual({ allowed: true, observedWindow: windowStart });
  });

  it('IP 超限拒绝并给出窗口剩余秒数；仅窗口首拒采样审计', async () => {
    const repo = makeRepo();
    repo.state.row = { window_start: windowStart, attempt_count: 21, fail_streak: 0, retry_after: null };
    const { service, logService } = makeService(repo);
    const decision = await service.reserveIpBucket('1.2.3.4', now);
    expect(decision).toMatchObject({ allowed: false, rejectedBy: 'window', retryAfterSeconds: 60 });
    expect(logService.write).toHaveBeenCalledTimes(1);
    // 同窗口后续拒绝不再刷审计
    repo.state.row = { window_start: windowStart, attempt_count: 22, fail_streak: 0, retry_after: null };
    await service.reserveIpBucket('1.2.3.4', now);
    expect(logService.write).toHaveBeenCalledTimes(1);
    const entry = (logService.write as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'login', entityType: 'auth', ip: '1.2.3.4' });
    expect(entry.detail).toContain('"scope":"ip"');
    expect(entry.username).toBeNull();
  });

  it('退避等待优先于窗口计数，剩余秒数向上取整', async () => {
    const repo = makeRepo();
    repo.state.row = { window_start: windowStart, attempt_count: 3, fail_streak: 7, retry_after: new Date(now.getTime() + 29500) };
    const { service } = makeService(repo);
    await expect(service.reserveAccountBucket(accountBucketKey(9), now)).resolves.toMatchObject({ allowed: false, rejectedBy: 'backoff', retryAfterSeconds: 30 });
  });

  it('账号超限拒绝：窗口剩余秒数至少 1', async () => {
    const repo = makeRepo();
    const accountWindowStart = new Date(Math.floor(now.getTime() / 900000) * 900000);
    repo.state.row = { window_start: accountWindowStart, attempt_count: 11, fail_streak: 0, retry_after: null };
    const { service } = makeService(repo);
    await expect(service.reserveAccountBucket(accountBucketKey(9), now)).resolves.toMatchObject({ allowed: false, rejectedBy: 'window' });
  });

  it('失败写回带阈值与 30/60/120/300 退避序列参数；成功复位带窗口代次条件', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);
    await service.recordAccountFailure(accountBucketKey(9), now);
    expect(repo.state.failParams[0]).toEqual([5, 4, 30, 60, 120, 300, now, now, 'acct:9']);
    expect(repo.state.updateSql[0]).toContain('ELT(LEAST(fail_streak - 4, ?)');
    await service.recordAccountSuccess(accountBucketKey(9), windowStart, now);
    expect(repo.state.updateSql[1]).toContain('attempt_count = IF(window_start <=> ?, 0, attempt_count)');
  });

  it('清理按最长窗口加保守余量计算截止时间并循环到空批', async () => {
    const repo = makeRepo();
    let batches = 0;
    repo.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('DELETE')) { batches += 1; return { affectedRows: batches === 1 ? 500 : 0 }; }
      return [];
    });
    const { service } = makeService(repo);
    const later = new Date('2026-11-04T09:00:00Z');
    await expect(service.purgeExpired(later)).resolves.toBe(500);
    // 账号窗口 900s + 600s 保守余量
    const cutoff = (repo.query as jest.Mock).mock.calls[0][1][0] as Date;
    expect(cutoff.getTime()).toBe(later.getTime() - 1500 * 1000);
    expect(batches).toBe(2);
  });

  it('存储故障抛 503，不静默放行', async () => {
    const repo = makeRepo();
    repo.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { service } = makeService(repo);
    const error: HttpException = await service.reserveIpBucket('1.2.3.4', now).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({ message: '登录服务暂时不可用，请稍后重试' });
  });

  it('拒绝异常携带稳定业务码与 Retry-After 秒数', () => {
    const error = LoginRateLimitService.rateLimitedError(31.2);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ reason: ACCOUNT_SECURITY_REASONS.LOGIN_RATE_LIMITED, retryAfterSeconds: 32 });
  });

  it('桶键口径：已存在账号用稳定 ID，未知账号用规范化不可逆键且大小写归并', () => {
    expect(accountBucketKey(42)).toBe('acct:42');
    expect(ipBucketKey('2001:db8::1')).toBe('ip:2001:db8::1');
    expect(pendingAccountBucketKey('Admin ')).toBe(pendingAccountBucketKey('admin'));
    expect(pendingAccountBucketKey('admin')).not.toContain('admin');
    expect(pendingAccountBucketKey('admin')).toMatch(/^acct:pending:[0-9a-f]{64}$/);
  });
});
