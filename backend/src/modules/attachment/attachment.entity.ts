import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export type AttachmentStatus = 'temp' | 'bound';
/** 上传来源：center=附件管理直传（文件库）；business=业务表单上传 */
export type AttachmentOrigin = 'center' | 'business';

/**
 * 私有业务附件（F08）：文件存储在静态挂载目录之外（ATTACHMENT_PRIVATE_DIR），
 * 一律经授权接口下载，不提供公开静态 URL。
 * 生命周期：附件管理直传（origin=center）永久保留为文件库文件；
 * 业务表单上传（origin=business）经子表声明式挂接为 bound，未挂接行仅为绑定中断的暂存。
 * 清理任务只回收已软删行的磁盘文件，不再按时间删除附件。
 * 业务记录挂接唯一走子表声明式（CrudBaseService ChildSpec），见 docs/adr/0001。
 */
@Entity('attachments')
@Index('idx_attachment_status_created', ['status', 'createdAt'])
@Index('idx_attachment_target', ['entityType', 'entityId'])
export class Attachment extends BaseEntity {
  @Column({ name: 'recycle_held', type: 'tinyint', default: 0, comment: '回收站保留，禁止清理任务回收' })
  recycleHeld: number;
  /** 相对 ATTACHMENT_PRIVATE_DIR 的存储路径（含月份子目录与随机文件名） */
  @Column({ name: 'storage_path', type: 'varchar', length: 260 })
  storagePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int', comment: '字节数' })
  size: number;

  @Column({ type: 'varchar', length: 20, default: 'temp', comment: 'temp=未挂接（历史值，含文件库文件） bound=已随业务记录挂接' })
  status: AttachmentStatus;

  @Column({ type: 'varchar', length: 10, default: 'center', comment: '上传来源：center=附件管理直传（文件库） business=业务表单' })
  origin: AttachmentOrigin;

  @Column({ name: 'entity_type', type: 'varchar', length: 50, nullable: true, comment: '挂接的业务来源标识（子表声明式的 sourceType）' })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true, comment: '挂接的业务记录 ID（子表声明式的来源关联列）' })
  entityId: number | null;

  @Column({ name: 'entity_title', type: 'varchar', length: 255, nullable: true, comment: '绑定时单据标题快照，用于附件中心展示与穿透；单据改名不回刷' })
  entityTitle: string | null;
}
