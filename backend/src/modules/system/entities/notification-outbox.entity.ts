import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OutboxStatus = 'pending' | 'delivered' | 'failed' | 'skipped';

/** 投递重试间隔（秒）：5 次尝试后 failed（契约 §3）。 */
export const OUTBOX_RETRY_SECONDS = [5, 30, 120, 600, 1800] as const;
/** 投递租约时长（秒）：过期可被其他实例抢占。 */
export const OUTBOX_LEASE_SECONDS = 60;

@Entity('notification_outbox')
@Index('uniq_outbox_delivery', ['eventId', 'recipientId', 'type'], { unique: true })
@Index('idx_outbox_dispatch', ['status', 'nextAttemptAt', 'leaseExpiresAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn()
  id: number;

  /** 业务事件标识＝example_events.id：同一单据再次合法指派产生新事件，不丢通知。 */
  @Column({ name: 'event_id', type: 'varchar', length: 64, comment: '业务事件标识（example_events.id）' })
  eventId: string;

  @Column({ name: 'recipient_id', type: 'int', comment: '接收人（新负责人）' })
  recipientId: number;

  @Column({ type: 'varchar', length: 50, comment: '通知类型（owner-changed）' })
  type: string;

  @Column({ name: 'biz_type', type: 'varchar', length: 50, nullable: true })
  bizType: string | null;

  @Column({ name: 'biz_id', type: 'int', nullable: true })
  bizId: number | null;

  @Column({ type: 'varchar', length: 200, comment: '最小文本标题（不含业务正文）' })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending', comment: 'pending/delivered/failed/skipped' })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0, comment: '已尝试次数' })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'datetime', nullable: true, comment: '下次重试时刻' })
  nextAttemptAt: Date | null;

  @Column({ name: 'lease_expires_at', type: 'datetime', nullable: true, comment: '投递租约到期' })
  leaseExpiresAt: Date | null;

  @Column({ name: 'lease_owner', type: 'varchar', length: 100, nullable: true, comment: '持有者 host:pid' })
  leaseOwner: string | null;

  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true, comment: '脱敏错误' })
  lastError: string | null;

  @Column({ name: 'delivered_notification_id', type: 'int', nullable: true, comment: '落库通知 ID（幂等证据）' })
  deliveredNotificationId: number | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
