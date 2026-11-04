import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 登录尝试计数（账号安全第一批规格 3.1）：以 MySQL 为跨进程共享存储，
 * 一行一个限流桶，通过主键原子 UPSERT 实现「昂贵密码验证前预占额度」。
 *
 * 桶键口径（与登录查询的账号等价性一致，见 account-security.contracts.ts）：
 * - 'ip:<客户端IP>'：IP 维度固定窗口（默认 60 秒 20 次，跨账号累计）。
 * - 'acct:<userId>'：已存在账号按稳定用户 ID 归并（数据库 username 排序规则
 *   utf8mb4_unicode_ci 大小写/重音不敏感，'Admin' 与 'admin' 是同一账号同一桶）。
 * - 'acct:pending:<sha256hex>'：不存在账号对规范化输入取不可逆键，不落明文。
 *
 * window_start 兼作窗口代次：并发请求写回（成功复位、失败退避）都必须带上
 * 读取时的 window_start 条件，旧窗口的迟到结果不得污染新窗口。
 *
 * 技术计数表，不含业务审计字段：不继承 BaseEntity（无软删除/归属语义），
 * 过期行按 updated_at 索引有界批量清理，多实例重复清理安全。
 */
@Entity('login_attempt_counters')
@Index('idx_login_attempt_counters_updated_at', ['updatedAt'])
export class LoginAttemptCounter {
  @PrimaryColumn({ name: 'bucket_key', type: 'varchar', length: 150, comment: '限流桶键：ip:/acct:/acct:pending:' })
  bucketKey: string;

  /** 当前固定窗口起点（按窗口秒数取整）；NULL=尚未开窗。 */
  @Column({ name: 'window_start', type: 'datetime', nullable: true, comment: '当前固定窗口起点，兼作窗口代次' })
  windowStart: Date | null;

  @Column({ name: 'window_seconds', type: 'int', default: 0, comment: '窗口长度（秒）：IP 60 / 账号 900' })
  windowSeconds: number;

  /** 窗口内已预占的尝试次数；超过配额即拒绝，被拒请求不再延长窗口时间。 */
  @Column({ name: 'attempt_count', type: 'int', default: 0, comment: '窗口内尝试计数' })
  attemptCount: number;

  /** 连续失败次数；达到阈值后进入递增退避（30/60/120/300 秒封顶）。 */
  @Column({ name: 'fail_streak', type: 'int', default: 0, comment: '连续失败次数' })
  failStreak: number;

  /** 失败退避到期时间；到期按服务端时间自动恢复，不写用户 status。 */
  @Column({ name: 'retry_after', type: 'datetime', nullable: true, comment: '失败退避到期时间，NULL=无退避' })
  retryAfter: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
