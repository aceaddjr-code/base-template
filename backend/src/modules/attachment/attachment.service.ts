import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, resolve } from 'path';
import { LessThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Attachment, AttachmentStatus } from './attachment.entity';
import { canAccessBoundAttachment, getAttachmentTarget } from './attachment-registry';
import { monthPath } from '../../common/uploads/upload.service';
import { SystemLogService } from '../system/system-log.service';

const ALLOWED_EXTS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.txt', '.csv', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
];
const MAX_SIZE = 20 * 1024 * 1024;

export interface AttachmentView {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  entityType: string | null;
  entityId: number | null;
  mine: boolean;
  createdAt: string | Date;
}

@Injectable()
export class AttachmentService {
  constructor(
    @InjectRepository(Attachment) private readonly attachmentRepo: Repository<Attachment>,
    private readonly config: ConfigService,
    private readonly logService: SystemLogService,
  ) {}

  private privateRoot(): string {
    return resolve(process.cwd(), this.config.get<string>('ATTACHMENT_PRIVATE_DIR', 'uploads-private'));
  }

  /** 防路径穿越：解析后必须仍在私有根内 */
  private absolutePath(storagePath: string): string {
    const root = this.privateRoot();
    const target = resolve(root, storagePath);
    if (!target.startsWith(root)) throw new BadRequestException('非法的存储路径');
    return target;
  }

  /** multer 目标工厂用：私有根 + 月份子目录（首传自建） */
  ensurePrivateDir(): string {
    const dir = resolve(this.privateRoot(), monthPath());
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  async saveFile(file: Express.Multer.File, user: JwtPayload): Promise<AttachmentView> {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) throw new BadRequestException('不支持的文件类型');
    if (!file.size || file.size > MAX_SIZE) throw new BadRequestException('文件大小超出限制（最大 20MB）');
    const storagePath = `${monthPath()}/${file.filename}`;
    const row = await this.attachmentRepo.save({
      storagePath,
      originalName: file.originalname.slice(0, 255),
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      status: 'temp' as AttachmentStatus,
      createdBy: user.sub,
      updatedBy: user.sub,
    });
    await this.writeLog('create', row, user);
    return this.toView(row, user);
  }

  async findPage(page: number, pageSize: number, status: string | undefined, user: JwtPayload) {
    page = Number.isFinite(page) && page > 0 ? page : 1;
    pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const qb = this.attachmentRepo.createQueryBuilder('a')
      .where('a.deletedAt IS NULL')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (status === 'temp' || status === 'bound') qb.andWhere('a.status = :status', { status });
    if (user.roleCode !== 'admin') qb.andWhere('a.createdBy = :me', { me: user.sub });
    const [list, total] = await qb.getManyAndCount();
    return { list: list.map((row) => this.toView(row, user)), total, page, pageSize };
  }

  /** 授权下载：temp 仅上传者/管理员；bound 走注册表裁决 */
  async resolveForDownload(id: number, user: JwtPayload): Promise<{ row: Attachment; streamPath: string }> {
    const row = await this.mustGet(id);
    const accessible = row.status === 'temp'
      ? row.createdBy === user.sub || user.roleCode === 'admin'
      : await canAccessBoundAttachment(row.entityType ?? '', row.entityId ?? 0, user, row.createdBy === user.sub, user.roleCode === 'admin');
    if (!accessible) throw new NotFoundException('附件不存在');
    const streamPath = this.absolutePath(row.storagePath);
    if (!existsSync(streamPath)) {
      // 文件已丢失：行保留（可在管理列表删除），给出可理解的错误而非 500
      throw new ServiceUnavailableException('附件文件已丢失，请联系管理员删除该记录');
    }
    return { row, streamPath };
  }

  async bind(id: number, entityType: string, entityId: number, user: JwtPayload): Promise<AttachmentView> {
    if (!getAttachmentTarget(entityType)) throw new BadRequestException('未登记的绑定目标类型');
    const row = await this.mustGet(id);
    if (row.status === 'bound') throw new BadRequestException('该附件已绑定其他记录，请先解绑');
    if (row.createdBy !== user.sub && user.roleCode !== 'admin') throw new NotFoundException('附件不存在');
    row.status = 'bound';
    row.entityType = entityType;
    row.entityId = entityId;
    row.updatedBy = user.sub;
    const saved = await this.attachmentRepo.save(row);
    await this.writeLog('update', saved, user, JSON.stringify({ status: 'bound', target: `${entityType}:${entityId}` }));
    return this.toView(saved, user);
  }

  async unbind(id: number, user: JwtPayload): Promise<AttachmentView> {
    const row = await this.mustGet(id);
    if (row.status !== 'bound') throw new BadRequestException('该附件未绑定');
    if (row.createdBy !== user.sub && user.roleCode !== 'admin') throw new NotFoundException('附件不存在');
    row.status = 'temp';
    row.entityType = null;
    row.entityId = null;
    row.updatedBy = user.sub;
    const saved = await this.attachmentRepo.save(row);
    await this.writeLog('update', saved, user, JSON.stringify({ status: 'temp' }));
    return this.toView(saved, user);
  }

  /** 删除：temp 仅上传者/管理员；bound 走注册表裁决（不误删仍有引用的文件）。行删文件删；文件缺失仍清行；磁盘失败可重试 */
  async remove(id: number, user: JwtPayload): Promise<{ message: string }> {
    const row = await this.mustGet(id);
    const accessible = row.status === 'temp'
      ? row.createdBy === user.sub || user.roleCode === 'admin'
      : await canAccessBoundAttachment(row.entityType ?? '', row.entityId ?? 0, user, row.createdBy === user.sub, user.roleCode === 'admin');
    if (!accessible) throw new NotFoundException('附件不存在');
    const abs = this.absolutePath(row.storagePath);
    if (existsSync(abs)) {
      try {
        unlinkSync(abs);
      } catch {
        throw new ServiceUnavailableException('附件文件删除失败，请稍后重试');
      }
    }
    await this.attachmentRepo.remove(row);
    await this.writeLog('delete', row, user);
    return { message: '删除成功' };
  }

  /**
   * 过期临时附件清理（F08）：删除超过保留期的 temp 行与其磁盘文件；
   * 文件缺失只清行；磁盘删除失败保留行留待下次。返回移除的行数。
   */
  async sweepExpiredTemp(retentionHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionHours * 3600_000);
    const stale = await this.attachmentRepo.find({
      where: { status: 'temp', createdAt: LessThan(cutoff) },
      take: 500,
    });
    let removed = 0;
    for (const row of stale) {
      const abs = this.absolutePath(row.storagePath);
      if (existsSync(abs)) {
        try { unlinkSync(abs); } catch { continue; }
      }
      await this.attachmentRepo.remove(row);
      removed++;
    }
    if (removed) {
      await this.logService.write({
        userId: null, username: null, action: 'delete',
        entityType: 'attachments', entityId: 0, entityDesc: `清理过期临时附件 ${removed} 条`,
        detail: JSON.stringify({ retentionHours, removed }),
      });
    }
    return removed;
  }

  private async mustGet(id: number): Promise<Attachment> {
    if (!Number.isInteger(id)) throw new NotFoundException('附件不存在');
    const row = await this.attachmentRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('附件不存在');
    return row;
  }

  private toView(row: Attachment, user: JwtPayload): AttachmentView {
    return {
      id: row.id,
      name: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      status: row.status,
      entityType: row.entityType,
      entityId: row.entityId,
      mine: row.createdBy === user.sub,
      createdAt: row.createdAt,
    };
  }

  private async writeLog(action: string, row: Attachment, user: JwtPayload, detail?: string): Promise<void> {
    await this.logService.write({
      userId: user.sub, username: user.username, action,
      entityType: 'attachments', entityId: row.id, entityDesc: row.originalName,
      detail: detail ?? JSON.stringify({ status: row.status }),
    });
  }

  /** 下载流与响应头（RFC 5987 中文文件名） */
  openDownload(row: Attachment) {
    const abs = this.absolutePath(row.storagePath);
    return { stream: createReadStream(abs), contentDisposition: `attachment; filename="${row.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}` };
  }
}
