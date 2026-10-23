import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

export interface NotifyPayload {
  title: string;
  content?: string;
  type: string;
  bizType?: string;
  bizId?: number;

}

/** 站内通知的写入、分页、未读数和已读状态。 */
@Injectable()
export class NotificationService {

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
  ) {}

  /** 给指定用户写入站内通知；失败时向调用方返回错误。 */
  async notify(userIds: number | number[], payload: NotifyPayload): Promise<void> {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (ids.length) await this.notifRepo.save(ids.map(userId => ({ userId, ...payload })));
  }

  /** 当前用户通知分页列表（新→旧） */
  async findMine(userId: number, page = 1, pageSize = 10, readStatus: 'all' | 'unread' = 'all') {
    const [list, total] = await this.notifRepo.findAndCount({
      where: { userId, ...(readStatus === 'unread' ? { readAt: IsNull() } : {}) },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** 未读数 */
  async unreadCount(userId: number): Promise<number> {
    return this.notifRepo.count({ where: { userId, readAt: IsNull() } });
  }

  /** 标已读 */
  async markRead(userId: number, id: number): Promise<void> {
    await this.notifRepo.update({ id, userId }, { readAt: new Date() });
  }

  /** 全部已读 */
  async markAllRead(userId: number): Promise<void> {
    await this.notifRepo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }

}
