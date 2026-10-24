import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export type AttachmentStatus = 'temp' | 'bound';

/**
 * 私有业务附件（F08）：文件存储在静态挂载目录之外（ATTACHMENT_PRIVATE_DIR），
 * 一律经授权接口下载，不提供公开静态 URL。
 * 生命周期：上传即 temp（归属上传者）；过期 temp 由清理任务移除。
 * 业务记录挂接唯一走子表声明式（CrudBaseService ChildSpec），见 docs/adr/0001。
 */
@Entity('attachments')
@Index('idx_attachment_status_created', ['status', 'createdAt'])
@Index('idx_attachment_target', ['entityType', 'entityId'])
export class Attachment extends BaseEntity {
  /** 相对 ATTACHMENT_PRIVATE_DIR 的存储路径（含月份子目录与随机文件名） */
  @Column({ name: 'storage_path', type: 'varchar', length: 260 })
  storagePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int', comment: '字节数' })
  size: number;

  @Column({ type: 'varchar', length: 20, default: 'temp', comment: 'temp=临时 bound=已随业务记录挂接' })
  status: AttachmentStatus;

  @Column({ name: 'entity_type', type: 'varchar', length: 50, nullable: true, comment: '挂接的业务来源标识（子表声明式的 sourceType）' })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true, comment: '挂接的业务记录 ID（子表声明式的来源关联列）' })
  entityId: number | null;
}
