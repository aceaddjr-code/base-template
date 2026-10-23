import { BadRequestException, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemLog } from './entities/system-log.entity';
import { serializeAuditDetail } from '../../common/utils/log-sanitizer';
import { requestContext } from '../../common/utils/request-context';
import { dateRangeBounds } from '../../common/utils/date-range';

export interface LogEntry {
  userId?: number | null;
  username?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  entityDesc?: string | null;
  detail?: string | null;
  ip?: string | null;
}

export interface LogQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  action?: string;
  entityType?: string;
  username?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class SystemLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemLogService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(
    @InjectRepository(SystemLog)
    private logRepo: Repository<SystemLog>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (Number(this.config.get('AUDIT_RETENTION_DAYS') ?? 0) <= 0) return;
    this.cleanupTimer = setInterval(() => { void this.purgeExpired().catch(() => this.logger.warn('过期审计日志清理失败')); }, 3600000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  /** 显式启用后，每小时最多永久删除 1000 条；默认 0 不清理。 */
  async purgeExpired(): Promise<number> {
    const days = Number(this.config.get('AUDIT_RETENTION_DAYS') ?? 0);
    if (days <= 0 || this.cleaning) return 0;
    this.cleaning = true;
    try {
      const cutoff = new Date(Date.now() - days * 86400000);
      const rows = await this.logRepo.createQueryBuilder('l').withDeleted().select('l.id', 'id')
        .where('l.createdAt < :cutoff', { cutoff }).orderBy('l.id', 'ASC').take(1000).getRawMany<{ id: number }>();
      if (!rows.length) return 0;
      const result = await this.logRepo.delete(rows.map(row => row.id));
      return result.affected ?? 0;
    } finally { this.cleaning = false; }
  }

  async write(entry: LogEntry) {
    try {
      await this.logRepo.save(this.logRepo.create({ ...entry, detail: serializeAuditDetail(entry.detail) }));
    } catch (e) {
      this.logger.warn(`审计日志写入失败 requestId=${requestContext.getStore()?.requestId ?? 'none'}`);
    }
  }

  /** 审计日志查询（admin，操作日志管理页） */
  async findAll(query: LogQuery) {
    const bounds = dateRangeBounds(query.dateFrom, query.dateTo);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const qb = this.logRepo
      .createQueryBuilder('l')
      .where('l.deletedAt IS NULL')
      .orderBy('l.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.keyword) {
      qb.andWhere(
        '(l.username LIKE :kw OR l.entityType LIKE :kw OR l.entityDesc LIKE :kw OR l.detail LIKE :kw)',
        { kw: `%${query.keyword}%` },
      );
    }
    if (query.action) {
      const actions = [...new Set(query.action.split(',').map(value => value.trim()).filter(Boolean))];
      if (!actions.length || actions.length > 20) throw new BadRequestException('操作类型筛选无效');
      qb.andWhere('l.action IN (:...actions)', { actions });
    }
    if (query.entityType) qb.andWhere('l.entityType = :et', { et: query.entityType });
    if (query.username) qb.andWhere('l.username = :un', { un: query.username });
    if (bounds.from) qb.andWhere('l.createdAt >= :from', { from: bounds.from });
    if (bounds.before) qb.andWhere('l.createdAt < :before', { before: bounds.before });

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }
}
