import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { NotificationOutbox, OUTBOX_LEASE_SECONDS, OUTBOX_RETRY_SECONDS } from './entities/notification-outbox.entity';
import { Notification } from './entities/notification.entity';
import { User } from '../user/user.entity';
import { hostname } from 'node:os';

/** 注入令牌：ExampleService 以 @Optional 引用投递器，避免测试构造必传（模块内仍直连）。 */
export const NOTIFICATION_OUTBOX = Symbol('NOTIFICATION_OUTBOX');

/** 管理端补发权限码（挂「我的通知」页管理区；admin 类边界保留）。 */
export const NOTIFICATION_RETRY_PERMISSION = 'system-notifications:retry';

/**
 * 通知 outbox 投递器（第五批契约 §4）：租约领取→通知写入与成功标记同事务→有限重试。
 * 双实例安全：DB 租约＋条件 UPDATE；进程内互斥防同实例并发轮询。
 */
@Injectable()
export class NotificationOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly leaseOwner = `${hostname()}:${process.pid}`;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(NotificationOutbox)
    private readonly outboxRepo: Repository<NotificationOutbox>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.deliverPending().catch(() => this.logger.warn('outbox 投递轮询失败')); }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** 业务事务内写入待投递意图（与单据变更/履历同事务；回滚即无通知）。 */
  async enqueueWithinTx(
    manager: any,
    entry: { eventId: string; recipientId: number; type: string; bizType?: string | null; bizId?: number | null; title: string; content?: string | null },
  ): Promise<void> {
    await manager.getRepository(NotificationOutbox).insert({ ...entry, bizType: entry.bizType ?? null, bizId: entry.bizId ?? null, content: entry.content ?? null, status: 'pending' });
  }

  /** 领取待投递（租约 60s，过期可抢占）并逐条投递。返回本轮各状态计数。 */
  async deliverPending(options: { limit?: number; now?: Date } = {}): Promise<{ claimed: number; delivered: number; skipped: number; rescheduled: number; failed: number }> {
    if (this.running) return { claimed: 0, delivered: 0, skipped: 0, rescheduled: 0, failed: 0 };
    this.running = true;
    const limit = options.limit ?? 10;
    const now = options.now ?? new Date();
    try {
      // 原子领取：pending 且到达重试时刻且无有效租约
      const claim = await this.outboxRepo.query(
        `UPDATE notification_outbox
         SET lease_owner = ?, lease_expires_at = TIMESTAMPADD(SECOND, ?, ?), attempts = attempts + 1, updated_at = ?
         WHERE status = 'pending'
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_expires_at IS NULL OR lease_expires_at < ?)
         ORDER BY id
         LIMIT ?`,
        [this.leaseOwner, OUTBOX_LEASE_SECONDS, now, now, now, now, limit],
      );
      const claimed = Number(claim.affectedRows ?? 0);
      if (!claimed) return { claimed: 0, delivered: 0, skipped: 0, rescheduled: 0, failed: 0 };
      const claimedRows = await this.outboxRepo.find({
        where: { status: 'pending', leaseOwner: this.leaseOwner },
        order: { id: 'ASC' },
        take: claimed,
      });
      let delivered = 0, skipped = 0, rescheduled = 0, failed = 0;
      for (const row of claimedRows) {
        try {
          const outcome = await this.deliverOne(row);
          if (outcome === 'delivered') delivered += 1;
          else if (outcome === 'skipped') skipped += 1;
        } catch (error) {
          // 基础设施异常：按重试表或 failed
          const attempts = row.attempts;
          if (attempts >= OUTBOX_RETRY_SECONDS.length) {
            await this.outboxRepo.update(row.id, { status: 'failed', lastError: sanitize(error), leaseOwner: null, leaseExpiresAt: null });
            failed += 1;
          } else {
            const nextAt = new Date(now.getTime() + OUTBOX_RETRY_SECONDS[attempts - 1] * 1000);
            await this.outboxRepo.update(row.id, { nextAttemptAt: nextAt, lastError: sanitize(error), leaseOwner: null, leaseExpiresAt: null });
            rescheduled += 1;
          }
        }
      }
      return { claimed, delivered, skipped, rescheduled, failed };
    } finally {
      this.running = false;
    }
  }

  /** 单条投递：通知写入＋成功标记同事务（唯一键幂等，崩溃重试不重复）。 */
  private async deliverOne(row: NotificationOutbox): Promise<'delivered' | 'skipped'> {
    // 停用/删除接收人：skipped 且不自动补发
    const recipient = await this.dataSource.getRepository(User).findOne({
      where: { id: row.recipientId },
      select: { id: true, status: true },
      withDeleted: true,
    });
    if (!recipient || recipient.status !== 1) {
      await this.outboxRepo.update(row.id, { status: 'skipped', lastError: '接收人已停用或删除', leaseOwner: null, leaseExpiresAt: null });
      return 'skipped';
    }
    const sourceKey = `${row.type}:${row.eventId}:${row.recipientId}`;
    const notificationId = await this.dataSource.transaction(async manager => {
      // 幂等插入：唯一键冲突说明此前已落库（崩溃后重试场景），复用既有通知并补标记
      const existing = await manager.findOne(Notification, { where: { sourceKey } });
      if (existing) {
        await manager.update(NotificationOutbox, row.id, {
          status: 'delivered', deliveredNotificationId: existing.id, lastError: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null,
        });
        return existing.id;
      }
      const saved = await manager.save(Notification, {
        userId: row.recipientId,
        type: row.type,
        title: row.title,
        content: row.content ?? null,
        bizType: row.bizType ?? null,
        bizId: row.bizId ?? null,
        sourceKey,
      });
      await manager.update(NotificationOutbox, row.id, {
        status: 'delivered', deliveredNotificationId: saved.id, lastError: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null,
      });
      return saved.id;
    });
    void notificationId;
    return 'delivered';
  }

  /** 管理端补发：failed → pending（清租约/重试时刻）；重复点击受租约与唯一键保护。 */
  async retryFailed(ids?: number[]): Promise<{ requeued: number }> {
    const result = await this.outboxRepo.createQueryBuilder()
      .update(NotificationOutbox)
      .set({ status: 'pending', nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null })
      .where("status = 'failed' AND id IN (:...ids)", { ids: ids?.length ? ids : [-1] })
      .execute();
    return { requeued: Number(result.affected ?? 0) };
  }

  /** 管理端失败列表（脱敏）。 */
  async failedList(page = 1, pageSize = 20): Promise<{ list: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
    const [rows, total] = await this.outboxRepo.findAndCount({
      where: { status: 'failed' },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      list: rows.map(row => ({
        id: row.id, eventId: row.eventId, recipientId: row.recipientId, type: row.type,
        attempts: row.attempts, lastError: row.lastError, updatedAt: row.updatedAt,
      })),
      total, page, pageSize,
    };
  }

  /** 供 SSE 轮询：某用户通知是否发生变化（跨实例共享存储即事实源）。 */
  async userVersion(userId: number): Promise<string> {
    const row = await this.outboxRepo.query(
      'SELECT COALESCE(MAX(id),0) AS maxId, COALESCE(SUM(read_at IS NULL),0) AS unread FROM notifications WHERE user_id = ?',
      [userId],
    );
    return `${row[0]?.maxId ?? 0}:${row[0]?.unread ?? 0}`;
  }

  async pendingForRecipient(recipientId: number): Promise<NotificationOutbox[]> {
    return this.outboxRepo.find({ where: { recipientId, status: In(['pending', 'failed']) } });
  }
}

function sanitize(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/(password|passwd|secret|token)\s*=\s*\S+/gi, '$1=***').slice(0, 500);
}
