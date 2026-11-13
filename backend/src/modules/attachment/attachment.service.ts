import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, isAbsolute, relative, resolve, sep } from 'path';
import { IsNull, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import type { JwtPayload } from '../auth/jwt.strategy';
import { Attachment, AttachmentOrigin, AttachmentStatus } from './attachment.entity';
import { ATTACHMENT_TARGET_REGISTRY } from './attachment-targets.registry';
import { ATTACHMENTS_SCOPE_KEY, findAttachmentScopeSubject } from './attachment-access';
import { monthPath } from '../../common/uploads/upload.service';
import { isSystemAdmin } from '../../common/utils/permission-check';
import { assertCanOperateOn, scopeWhereClause } from '../../common/utils/data-scope';
import { SystemLogService } from '../system/system-log.service';
import { User } from '../user/user.entity';
import { AttachmentRecycle } from './attachment-recycle.entity';

/** 附件管理（文件库页签）的数据范围 scopeKey；业务附件跟随各业务模块自己的 scopeKey。 */

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
  origin: AttachmentOrigin;
  entityType: string | null;
  entityId: number | null;
  /** 绑定时单据标题快照，用于附件中心展示与穿透 */
  entityTitle: string | null;
  /** 上传人显示名（displayName 缺失时回退用户名；用户被删则为 null） */
  uploaderName: string | null;
  mine: boolean;
  ownerId: number | null;
  createdAt: string | Date;
}

/** 列表查询参数：origin 区分文件库/业务附件两个页签 */
export interface AttachmentListQuery {
  origin?: string;
  status?: string;
  entityType?: string;
  keyword?: string;
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

  /** origin=center 为附件管理直传（文件库，永久保留）；business 为业务表单上传（等待挂接） */
  async saveFile(file: Express.Multer.File, user: JwtPayload, origin: AttachmentOrigin = 'center'): Promise<AttachmentView> {
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
        origin,
        ownerId: user.sub,
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

  /** 多段 scope 条件拼接时给参数加前缀，避免不同 scopeKey 生成的同名参数冲突 */
  private prefixedScope(sql: string, params: Record<string, any>, prefix: string): { sql: string; params: Record<string, any> } {
    const renamed: Record<string, any> = {};
    let out = sql;
    for (const [key, value] of Object.entries(params)) {
      const to = `${prefix}_${key}`;
      out = out.replace(new RegExp(`:\\.\\.\\.${key}(?![\\w])`, 'g'), `:...${to}`).replace(new RegExp(`:${key}(?![\\w])`, 'g'), `:${to}`);
      renamed[to] = value;
    }
    return { sql: out, params: renamed };
  }

  /**
   * 附件中心列表（双页签双轨可见性）：
   * - origin=center（文件库）：按附件管理自身数据范围（scopeKey=attachments）过滤 ownerId；
   * - origin=business（业务附件）：已挂接行跟随所属单据的数据范围（按挂接目标注册表逐个 EXISTS），
   *   未挂接暂存行仅上传者可见；未注册类型的已挂接行仅管理员可见。
   */
  async findPage(page: number, pageSize: number, query: AttachmentListQuery, user: JwtPayload, accessCodes: string[] = []) {
    page = Number.isFinite(page) && page > 0 ? page : 1;
    pageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const origin: AttachmentOrigin = query.origin === 'business' ? 'business' : 'center';
    const qb = this.attachmentRepo.createQueryBuilder('a')
      .where('a.deletedAt IS NULL')
      .andWhere('a.origin = :origin', { origin })
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (query.status === 'temp' || query.status === 'bound') qb.andWhere('a.status = :status', { status: query.status });
    if (query.entityType && query.entityType.trim()) qb.andWhere('a.entityType = :entityType', { entityType: query.entityType.trim().slice(0, 50) });
    const keyword = query.keyword?.trim();
    if (keyword) qb.andWhere('(a.originalName LIKE :keyword OR a.entityTitle LIKE :keyword)', { keyword: `%${keyword.slice(0, 100)}%` });

    if (!isSystemAdmin(user)) {
      if (origin === 'center') {
        const { sql, params } = scopeWhereClause('a', user, ATTACHMENTS_SCOPE_KEY);
        if (sql) qb.andWhere(sql, params);
      } else {
        const branches: string[] = ['(a.status = \'temp\' AND a.createdBy = :bizUid)'];
        const allParams: Record<string, any> = { bizUid: user.sub };
        for (const [index, target] of ATTACHMENT_TARGET_REGISTRY.entries()) {
          if (!accessCodes.includes(target.viewPermission)) continue;
          const clause = scopeWhereClause('e', user, target.scopeKey);
          // 子查询别名 e 未在 QueryBuilder 注册，属性名不会被翻译成列名，需手工转成真实列名（scope 条件只引用 ownerId）
          const { sql, params } = this.prefixedScope((clause.sql ?? '1 = 1').replace(/\be\.ownerId\b/g, 'e.owner_id'), clause.params, `t${index}`);
          branches.push(
            `(a.status = 'bound' AND a.entityType = :et${index} AND EXISTS (
              SELECT 1 FROM ${target.table} e WHERE e.id = a.entityId AND e.deleted_at IS NULL AND (${sql})
            ))`,
          );
          allParams[`et${index}`] = target.sourceType;
          Object.assign(allParams, params);
        }
        qb.andWhere(`(${branches.join(' OR ')})`, allParams);
      }
    }

    const [list, total] = await qb.getManyAndCount();
    const uploaderNames = await this.findUploaderNames(list.map((row) => row.id));
    return { list: list.map((row) => this.toView(row, user, uploaderNames.get(row.id) ?? null)), total, page, pageSize };
  }

  /** 批量取上传人显示名（displayName 缺省回退用户名；不排除软删用户，仅展示用途） */
  private async findUploaderNames(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!ids.length) return map;
    const rows: Array<{ id: number; uploaderName: string | null }> = await this.attachmentRepo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.createdBy')
      .select('a.id', 'id')
      .addSelect('COALESCE(u.display_name, u.username)', 'uploaderName')
      .where('a.id IN (:...ids)', { ids })
      .getRawMany();
    for (const row of rows) if (row.uploaderName) map.set(Number(row.id), row.uploaderName);
    return map;
  }

  /**
   * 授权下载（双轨裁决）：
   * - 文件库（origin=center）：按附件管理数据范围 view 裁决；
   * - 业务附件已挂接：按所属单据的数据范围 view 裁决（跟随业务模块，ADR-0001 演进点 1）；
   * - 业务附件未挂接（暂存）：仅上传者；管理员全程放行。
   */
  async resolveForDownload(id: number, user: JwtPayload): Promise<{ row: Attachment }> {
    const row = await this.mustGet(id);
    if (!isSystemAdmin(user)) {
      if (row.origin === 'center' || row.status === 'bound') {
        const subject = await findAttachmentScopeSubject(this.attachmentRepo, row, user);
        if (!subject) throw new NotFoundException('附件不存在或不在当前数据范围内');
        assertCanOperateOn(subject, user, subject.scopeKey, 'view');
      } else if (row.createdBy !== user.sub) {
        throw new NotFoundException('附件不存在');
      }
    }
    return { row };
  }

  /** 删除：文件库按附件范围 delete 裁决；业务附件未挂接仅上传者；已挂接从单据详情管理。 */
  async remove(id: number, user: JwtPayload): Promise<{ message: string }> {
    return this.attachmentRepo.manager.transaction(async manager => {
      const repo = manager.getRepository(Attachment);
      const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) throw new NotFoundException('附件不存在');
      if (row.origin === 'business') {
        if (row.status === 'bound') throw new NotFoundException('附件不存在，请从单据详情管理已绑定文件');
        if (row.createdBy !== user.sub && !isSystemAdmin(user)) throw new NotFoundException('附件不存在');
      } else {
        const subject = await findAttachmentScopeSubject(repo, row, user);
        if (!subject) throw new NotFoundException('文件不存在或不在当前操作范围内');
        assertCanOperateOn(subject, user, subject.scopeKey, 'delete');
      }
      await manager.getRepository(AttachmentRecycle).save({ attachmentId: row.id, deletedBy: user.sub, actorName: user.username, state: 'deleted' });
      await repo.update(row.id, { recycleHeld: 1 });
      await repo.softDelete(row.id);
      await this.writeLog('delete', row, user);
      return { message: '删除成功' };
    });
  }

  /**
   * 已删除附件的磁盘文件回收（F08 演进）：附件一律永久保留、不再按时间清理；
   * 这里只回收软删行（单据删除级联软删的 bound 附件等）的磁盘文件。
   * 文件缺失只清行；磁盘删除失败保留行留待下次。返回移除的行数。
   */
  async sweepDeletedFiles(): Promise<number> {
    const stale = await this.attachmentRepo.find({
      where: { deletedAt: Not(IsNull()), recycleHeld: 0 },
      withDeleted: true,
      take: 500,
    });
    let removed = 0;
    for (const row of stale) {
      const didRemove = await this.attachmentRepo.manager.transaction(async manager => {
        const repo = manager.getRepository(Attachment);
        // 与挂接/删除共用行锁，事务内复核仍是软删行，避免把刚恢复的行清掉。
        const current = await repo.findOne({ where: { id: row.id }, withDeleted: true, lock: { mode: 'pessimistic_write' } });
        if (!current || !current.deletedAt || current.recycleHeld) return false;
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
        entityType: 'attachments', entityId: 0, entityDesc: `回收已删除附件文件 ${removed} 条`,
        detail: JSON.stringify({ removed }),
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

  private toView(row: Attachment, user: JwtPayload, uploaderName: string | null = null): AttachmentView {
    return {
      id: row.id,
      name: row.originalName,
      mimeType: row.mimeType,
      size: row.size,
      status: row.status,
      origin: row.origin,
      entityType: row.entityType,
      entityId: row.entityId,
      entityTitle: row.entityTitle,
      uploaderName,
      mine: row.createdBy === user.sub,
      ownerId: row.ownerId ?? null,
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

  assertFileExists(row: Attachment): void {
    if (!existsSync(this.absolutePath(row.storagePath))) throw new ServiceUnavailableException('附件文件缺失，无法完整恢复单据');
  }

  eraseFile(row: Attachment): void {
    const path = this.absolutePath(row.storagePath);
    if (existsSync(path)) {
      try { unlinkSync(path); } catch { throw new ServiceUnavailableException('附件文件删除失败，请重试彻底删除'); }
    }
  }
}
