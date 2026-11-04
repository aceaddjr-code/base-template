import { Injectable, Logger, HttpException, HttpStatus, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoginAttemptCounter } from './login-attempt-counter.entity';
import { SystemLogService } from '../system/system-log.service';
import { ACCOUNT_SECURITY_REASONS, accountBucketKey, ipBucketKey } from './account-security.contracts';

/** 连续失败第 N 次起进入退避；等待序列 30/60/120/300 秒封顶（规格 3.1 固定值）。 */
const FAIL_BACKOFF_THRESHOLD = 5;
const FAIL_BACKOFF_WAIT_SECONDS = [30, 60, 120, 300] as const;
/** 每轮清理批量与周期；保留期须大于最长窗口＋最长退避。 */
const PURGE_BATCH = 500;
const PURGE_INTERVAL_MS = 10 * 60 * 1000;
const PURGE_MIN_RETENTION_SECONDS = 600;

export interface RateLimitDecision {
  allowed: boolean;
  /** 拒绝时的建议等待秒数（Retry-After），向上取整、至少 1。 */
  retryAfterSeconds?: number;
  /** 预占成功时读回的窗口起点，写回（成功复位）时用于窗口代次条件。 */
  observedWindow?: Date | null;
  rejectedBy?: 'window' | 'backoff';
}

/**
 * 登录联合限流（规格 3.1）：MySQL 共享计数，多实例一致。
 *
 * 顺序：全局粗限流（Throttler，保留）→ IP 桶（先处理，降低随机账号写入压力）
 * → 账号桶（昂贵密码验证前原子预占额度）。所有时间戳来自应用侧 Date 参数，
 * 不使用数据库 NOW()，避免多实例时钟/时区不一致；同一部署的各实例需保持
 * 一致的时区设置（与既有 TypeORM datetime 列约定相同）。
 *
 * 被拦截请求不写计数状态（时间字段不变，不延长等待或窗口）；仅首次超限
 * 采样写一条审计（聚合策略：计数表为聚合事实，审计按窗口首拒采样）。
 * 数据库故障抛 503，不静默放行（fail closed）。
 */
@Injectable()
export class LoginRateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoginRateLimitService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(
    @InjectRepository(LoginAttemptCounter)
    private readonly counterRepo: Repository<LoginAttemptCounter>,
    private readonly config: ConfigService,
    private readonly logService: SystemLogService,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => { void this.purgeExpired().catch(() => this.logger.warn('登录限流计数清理失败')); }, PURGE_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  private get ipWindowSeconds() { return Number(this.config.get('LOGIN_IP_WINDOW_SECONDS') ?? 60); }
  private get ipMax() { return Number(this.config.get('LOGIN_IP_MAX') ?? 20); }
  private get accountWindowSeconds() { return Number(this.config.get('LOGIN_ACCOUNT_WINDOW_SECONDS') ?? 900); }
  private get accountMax() { return Number(this.config.get('LOGIN_ACCOUNT_MAX') ?? 10); }

  /** IP 维度：固定窗口、跨账号累计；成功登录不清除。 */
  reserveIpBucket(clientIp: string, now = new Date()): Promise<RateLimitDecision> {
    return this.reserve(ipBucketKey(clientIp), this.ipWindowSeconds, this.ipMax, { scope: 'ip', ip: clientIp }, now);
  }

  /** 账号维度：固定窗口、跨 IP 共用；桶键由调用方按账号等价性口径构造。 */
  reserveAccountBucket(bucketKey: string, now = new Date(), context?: { ip?: string }): Promise<RateLimitDecision> {
    return this.reserve(bucketKey, this.accountWindowSeconds, this.accountMax, { scope: 'account', ip: context?.ip }, now);
  }

  /**
   * 原子预占一次尝试额度：INSERT ... ON DUPLICATE KEY UPDATE 以窗口起点为代次，
   * 同窗口累加、跨窗口重置（连续失败与退避保留，跨窗口继续计数）。
   */
  private async reserve(
    bucketKey: string,
    windowSeconds: number,
    max: number,
    audit: { scope: 'ip' | 'account'; ip?: string },
    now: Date,
  ): Promise<RateLimitDecision> {
    const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
    await this.guard(
      () => this.counterRepo.query(
        `INSERT INTO login_attempt_counters
           (bucket_key, window_start, window_seconds, attempt_count, fail_streak, retry_after, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
           attempt_count = IF(window_start <=> VALUES(window_start), attempt_count + 1, 1),
           window_seconds = VALUES(window_seconds),
           window_start = VALUES(window_start),
           updated_at = VALUES(updated_at)`,
        [bucketKey, windowStart, windowSeconds, now, now],
      ),
    );
    const rows = await this.guard(() => this.counterRepo.query(
      `SELECT window_start, attempt_count, fail_streak, retry_after
       FROM login_attempt_counters WHERE bucket_key = ?`,
      [bucketKey],
    ));
    const row = (rows as any[])[0];
    if (!row) throw this.serviceUnavailable();
    const retryAfter: Date | null = row.retry_after ?? null;
    if (retryAfter && retryAfter.getTime() > now.getTime()) {
      return this.rejected(audit, 'backoff', row.attempt_count, Math.ceil((retryAfter.getTime() - now.getTime()) / 1000));
    }
    if (Number(row.attempt_count) > max) {
      const windowEnd = windowStart.getTime() + windowSeconds * 1000;
      return this.rejected(audit, 'window', row.attempt_count, Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)));
    }
    return { allowed: true, observedWindow: row.window_start ?? null };
  }

  /** 拒绝结果：不写任何计数状态（时间字段保持不变）；每个窗口仅首次超限采样审计。 */
  private rejected(
    audit: { scope: 'ip' | 'account'; ip?: string },
    rejectedBy: 'window' | 'backoff',
    attemptCount: number,
    retryAfterSeconds: number,
  ): RateLimitDecision {
    if (attemptCount === this.limitFor(audit.scope) + 1) {
      void this.logService.write({
        action: 'login', entityType: 'auth', userId: null, username: null, ip: audit.ip ?? null,
        // 不记录账号明文猜测；聚合事实在计数表，此处仅按窗口首拒采样。
        detail: JSON.stringify({ event: 'login_rate_limited', scope: audit.scope, rejectedBy }),
      }).catch(() => undefined);
    }
    return { allowed: false, rejectedBy, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  private limitFor(scope: 'ip' | 'account') { return scope === 'ip' ? this.ipMax : this.accountMax; }

  /**
   * 密码验证失败：连续失败 +1；达到阈值后按 30/60/120/300 秒封顶设置退避。
   * 桶级更新（不带窗口条件）：迟到失败最多保守地多计一次，不会把等待时间回退。
   */
  async recordAccountFailure(bucketKey: string, now = new Date()): Promise<void> {
    await this.guard(() => this.counterRepo.query(
      `UPDATE login_attempt_counters
       SET fail_streak = fail_streak + 1,
           retry_after = IF(fail_streak >= ?, TIMESTAMPADD(SECOND, ELT(LEAST(fail_streak - 4, ?), ?, ?, ?, ?), ?), retry_after),
           updated_at = ?
       WHERE bucket_key = ?`,
      [FAIL_BACKOFF_THRESHOLD, FAIL_BACKOFF_WAIT_SECONDS.length, ...FAIL_BACKOFF_WAIT_SECONDS, now, now, bucketKey],
    ));
  }

  /**
   * 密码验证成功：清连续失败与退避；尝试计数仅在窗口代次未变时清零，
   * 过期成功不得清除新窗口内并发失败写入的计数。
   */
  async recordAccountSuccess(bucketKey: string, observedWindow: Date | null | undefined, now = new Date()): Promise<void> {
    await this.guard(() => this.counterRepo.query(
      `UPDATE login_attempt_counters
       SET fail_streak = 0,
           retry_after = NULL,
           attempt_count = IF(window_start <=> ?, 0, attempt_count),
           updated_at = ?
       WHERE bucket_key = ?`,
      [observedWindow ?? null, now, bucketKey],
    ));
  }

  /** 有界分批清理过期计数；多实例并发清理幂等安全。返回本轮删除行数。 */
  async purgeExpired(now = new Date()): Promise<number> {
    if (this.cleaning) return 0;
    this.cleaning = true;
    try {
      const retention = Math.max(this.ipWindowSeconds, this.accountWindowSeconds) + PURGE_MIN_RETENTION_SECONDS;
      const cutoff = new Date(now.getTime() - retention * 1000);
      let total = 0;
      for (let round = 0; round < 20; round++) {
        const result = await this.counterRepo.query(
          `DELETE FROM login_attempt_counters WHERE updated_at < ? ORDER BY updated_at LIMIT ?`,
          [cutoff, PURGE_BATCH],
        );
        const affected = Number((result as any)?.affectedRows ?? 0);
        total += affected;
        if (affected < PURGE_BATCH) break;
      }
      return total;
    } finally {
      this.cleaning = false;
    }
  }

  /** 数据库故障时登录裁决不可用：503 可重试，不静默放行。 */
  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`登录限流存储不可用: ${error instanceof Error ? error.message : error}`);
      throw this.serviceUnavailable();
    }
  }

  private serviceUnavailable() {
    return new HttpException({ message: '登录服务暂时不可用，请稍后重试' }, HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** 统一拒绝响应：429 + 稳定业务码 + Retry-After 秒数（过滤器写响应头）。 */
  static rateLimitedError(retryAfterSeconds: number): HttpException {
    return new HttpException({
      message: '尝试过于频繁，请稍后重试',
      reason: ACCOUNT_SECURITY_REASONS.LOGIN_RATE_LIMITED,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export { accountBucketKey, ipBucketKey };
