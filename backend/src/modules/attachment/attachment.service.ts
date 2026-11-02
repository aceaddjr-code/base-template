import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, isAbsolute, relative, resolve, sep } from 'path';
import { IsNull, Not, LessThan, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Attachment, AttachmentStatus } from './attachment.entity';
import { monthPath } from '../../common/uploads/upload.service';
import { isSystemAdmin } from '../../common/utils/permission-check';
import { SystemLogService } from '../system/system-log.service';

/** 图片归类与浏览器可预览格式分开，特殊图片保留原文件下载。 */
export const ATTACHMENT_IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/vnd.microsoft.icon',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif', '.svg': 'image/svg+xml',
};
export const ATTACHMENT_PREVIEW_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.ico']);
/** 附件扩展名白名单：控制器过滤与保存复核共用。 */
export const ATTACHMENT_ALLOWED_EXTS = [
  '.pdf', '.doc', '.docx', '.dot', '.dotx', '.xls', '.xlsx', '.xlsm', '.xlt', '.xltx', '.xltm', '.ppt', '.pptx', '.pps', '.ppsx',
  '.odt', '.ods', '.odp', '.rtf', '.txt', '.csv', '.tsv', '.md', '.log', '.json', '.xml', '.yaml', '.yml',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.dwg', '.dxf', '.step', '.stp', '.igs', '.iges', '.stl', '.3dm', '.vsd', '.vsdx', '.psd', '.ai', '.eps',
  '.mp3', '.wav', '.m4a', '.flac', '.mp4', '.mov', '.avi', '.wmv', '.mkv',
  ...Object.keys(ATTACHMENT_IMAGE_MIMES),
];
export const ATTACHMENT_MAX_SIZE = 500 * 1024 * 1024;

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
    if (!target.startsWith(root + sep)) throw new BadRequestException('非法的存储路径');
    return target;
  }

  /** multer 目标工厂用：私有根 + 月份子目录（首传自建） */
  ensurePrivateDir(): string {
    const dir = resolve(this.privateRoot(), monthPath());
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  async saveFile(file: Express.Multer.File, user: JwtPayload): Promise<AttachmentView> {
    const root = this.privateRoot();
    const actualPath = file.path ? resolve(file.path) : null;
    const storagePath = actualPath ? relative(root, actualPath).split(sep).join('/') : null;
    if (!storagePath || isAbsolute(storagePath) || storagePath === '..' || storagePath.startsWith('../')) throw new BadRequestException('非法的存储路径');
    let row: Attachment;
    try {
      const ext = extname(file.originalname).toLowerCase();
      if (!ATTACHMENT_ALLOWED_EXTS.includes(ext)) throw new BadRequestException('不支持的文件类型');
      if (!file.size || file.size > ATTACHMENT_MAX_SIZE) throw new BadRequestException('文件大小超出限制（最大 500MB）');
      row = await this.attachmentRepo.save({
        storagePath,
        originalName: file.originalname.slice(0, 255),
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        status: 'temp' as AttachmentStatus,
        createdBy: user.sub,
        updatedBy: user.sub,
      });
    } catch (error) {
      // 记录尚未建立时及时回收落盘文件，避免无数据库行的孤儿文件。
      try { if (existsSync(actualPath!)) unlinkSync(actualPath!); }
      catch { throw new ServiceUnavailableException('上传失败且文件清理失败，请联系管理员检查私有存储目录'); }
      throw error;
    }
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
    if (!isSystemAdmin(user)) qb.andWhere('a.createdBy = :me', { me: user.sub }).andWhere("(a.entityType IS NULL OR a.entityType <> :business)", { business: 'example-items' });
    const [list, total] = await qb.getManyAndCount();
    return { list: list.map((row) => this.toView(row, user)), total, page, pageSize };
  }

  /** 授权下载：仅上传者/管理员（已绑定附件的业务可见性裁决随子表声明式接入演进，见 docs/adr/0001） */
  async resolveForDownload(id: number, user: JwtPayload): Promise<{ row: Attachment; streamPath: string }> {
    const row = await this.mustGet(id);
    if (row.entityType === 'example-items' && !isSystemAdmin(user)) throw new NotFoundException('请从单据详情访问附件');
    if (row.createdBy !== user.sub && !isSystemAdmin(user)) throw new NotFoundException('附件不存在');
    const streamPath = this.absolutePath(row.storagePath);
    if (!existsSync(streamPath)) {
      // 文件已丢失：行保留（可在管理列表删除），给出可理解的错误而非 500
      throw new ServiceUnavailableException('附件文件已丢失，请联系管理员删除该记录');
    }
    return { row, streamPath };
  }

  /** 删除：仅上传者/管理员；行删文件删；文件缺失仍清行；磁盘失败可重试 */
  async remove(id: number, user: JwtPayload): Promise<{ message: string }> {
    return this.attachmentRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Attachment);
      const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.entityType === 'example-items' || (row.createdBy !== user.sub && !isSystemAdmin(user))) throw new NotFoundException('附件不存在，请从单据详情管理已绑定文件');
      const abs = this.absolutePath(row.storagePath);
      if (existsSync(abs)) {
        try { unlinkSync(abs); } catch { throw new ServiceUnavailableException('附件文件删除失败，请稍后重试'); }
      }
      await repo.remove(row);
      await this.writeLog('delete', row, user);
      return { message: '删除成功' };
    });
  }

  /**
   * 过期临时附件清理（F08）：删除超过保留期的 temp 行与其磁盘文件；
   * 文件缺失只清行；磁盘删除失败保留行留待下次。返回移除的行数。
   */
  async sweepExpiredTemp(retentionHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionHours * 3600_000);
    const stale = await this.attachmentRepo.find({
      where: [{ status: 'temp', createdAt: LessThan(cutoff) }, { deletedAt: Not(IsNull()) }],
      withDeleted: true,
      take: 500,
    });
    let removed = 0;
    for (const row of stale) {
      const didRemove = await this.attachmentRepo.manager.transaction(async manager => {
        const repo = manager.getRepository(Attachment);
        // 与单据挂接共用行锁，避免清理任务把刚绑定的临时文件删掉。
        const current = await repo.findOne({ where: { id: row.id }, withDeleted: true, lock: { mode: 'pessimistic_write' } });
        if (!current || (!current.deletedAt && (current.status !== 'temp' || current.createdAt >= cutoff))) return false;
        const abs = this.absolutePath(current.storagePath);
        if (existsSync(abs)) { try { unlinkSync(abs); } catch { return false; } }
        await repo.remove(current);
        return true;
      });
      if (didRemove) removed++;
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
    if (!existsSync(abs)) throw new ServiceUnavailableException('附件文件已丢失，请联系管理员');
    return { stream: createReadStream(abs), contentDisposition: `attachment; filename="${row.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}` };
  }
}
