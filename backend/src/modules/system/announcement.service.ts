import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement, AnnouncementStatus } from './entities/announcement.entity';
import { getUserId } from '../../common/utils/service-helpers';
import { SystemLogService } from './system-log.service';

const STATUS_VALUES: AnnouncementStatus[] = ['draft', 'published', 'withdrawn'];

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(Announcement) private readonly announcementRepo: Repository<Announcement>,
    private readonly logService: SystemLogService,
  ) {}

  /** 管理列表（全部状态），可按状态与标题关键词过滤 */
  async findPage(page = 1, pageSize = 20, status?: string, keyword?: string) {
    page = Number.isFinite(page) && page > 0 ? page : 1;
    pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const qb = this.announcementRepo.createQueryBuilder('a')
      .where('a.deletedAt IS NULL')
      .orderBy('a.updatedAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (status && STATUS_VALUES.includes(status as AnnouncementStatus)) {
      qb.andWhere('a.status = :status', { status });
    }
    if (keyword?.trim()) {
      qb.andWhere('a.title LIKE :kw', { kw: `%${keyword.trim()}%` });
    }
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 登录用户可读：仅已发布，按发布时间倒序 */
  async findPublishedPage(page = 1, pageSize = 10) {
    page = Number.isFinite(page) && page > 0 ? page : 1;
    pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 50) : 10;
    const [list, total] = await this.announcementRepo.findAndCount({
      where: { status: 'published' },
      order: { publishedAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, title: true, publishedAt: true },
    });
    return { list, total, page, pageSize };
  }

  async findById(id: number): Promise<Announcement> {
    const record = await this.announcementRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('公告不存在');
    return record;
  }

  /** 详情阅读：已发布对全部登录用户开放；其余状态仅 admin 管理列表进入 */
  async readDetail(id: number, isAdmin: boolean): Promise<Announcement> {
    if (!Number.isInteger(id)) throw new NotFoundException('公告不存在');
    const record = await this.findById(id);
    if (record.status !== 'published' && !isAdmin) throw new NotFoundException('公告不存在');
    return record;
  }

  /** DTO 的 MinLength 把纯空白当有效值，这里以裁剪结果为准做业务校验并给出字段路径 */
  private normalizeDraft(dto: { title: string; content: string }) {
    const title = dto.title?.trim() ?? '';
    const content = dto.content?.replace(/\r\n/g, '\n').trim() ?? '';
    if (!title) throw new BadRequestException({ message: '标题不能为空', fieldErrors: [{ path: 'title', code: 'required', message: '标题不能为空' }] });
    if (!content) throw new BadRequestException({ message: '正文不能为空', fieldErrors: [{ path: 'content', code: 'required', message: '正文不能为空' }] });
    return { title, content };
  }

  async create(dto: { title: string; content: string }, user?: any): Promise<Announcement> {
    const { title, content } = this.normalizeDraft(dto);
    const record = await this.announcementRepo.save({
      title, content, status: 'draft',
      createdBy: getUserId(user),
      updatedBy: getUserId(user),
    });
    await this.writeLog('create', record, user);
    return record;
  }

  /** 仅草稿可编辑；已发布需先撤回，避免对已展示内容静默换文 */
  async update(id: number, dto: { title: string; content: string }, user?: any): Promise<Announcement> {
    const record = await this.requireStatus(id, ['draft'], '只有草稿可以编辑，已发布的公告请先撤回');
    const { title, content } = this.normalizeDraft(dto);
    record.title = title;
    record.content = content;
    record.updatedBy = getUserId(user);
    const saved = await this.announcementRepo.save(record);
    await this.writeLog('update', saved, user);
    return saved;
  }

  async publish(id: number, user?: any): Promise<Announcement> {
    const record = await this.requireStatus(id, ['draft', 'withdrawn'], '只有草稿或已撤回的公告可以发布');
    record.status = 'published';
    record.publishedAt = new Date();
    record.publishedBy = getUserId(user);
    record.updatedBy = getUserId(user);
    const saved = await this.announcementRepo.save(record);
    await this.writeLog('publish', saved, user);
    return saved;
  }

  async withdraw(id: number, user?: any): Promise<Announcement> {
    const record = await this.requireStatus(id, ['published'], '只有已发布的公告可以撤回');
    record.status = 'withdrawn';
    record.updatedBy = getUserId(user);
    const saved = await this.announcementRepo.save(record);
    await this.writeLog('withdraw', saved, user);
    return saved;
  }

  /** 草稿与已撤回可删除；已发布需先撤回 */
  async remove(id: number, user?: any): Promise<{ message: string }> {
    const record = await this.requireStatus(id, ['draft', 'withdrawn'], '已发布的公告不能删除，请先撤回');
    await this.announcementRepo.softDelete(id);
    await this.writeLog('delete', record, user);
    return { message: '删除成功' };
  }

  private async requireStatus(id: number, allowed: AnnouncementStatus[], message: string): Promise<Announcement> {
    const record = await this.announcementRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('公告不存在');
    if (!allowed.includes(record.status)) throw new BadRequestException(message);
    return record;
  }

  private async writeLog(action: string, record: Announcement, user?: any) {
    await this.logService.write({
      userId: getUserId(user), username: user?.username, action,
      entityType: 'system_announcements', entityId: record.id, entityDesc: record.title,
      detail: JSON.stringify({ status: record.status }),
    });
  }
}
