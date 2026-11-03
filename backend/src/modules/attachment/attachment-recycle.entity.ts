import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** 只记录独立删除的附件；随单据删除的附件由单据删除批次管理。 */
@Entity('attachment_recycle')
export class AttachmentRecycle {
  @PrimaryColumn({ name: 'attachment_id', type: 'int' }) attachmentId: number;
  @Column({ name: 'deleted_by', type: 'int' }) deletedBy: number;
  @Column({ name: 'actor_name', type: 'varchar', length: 50 }) actorName: string;
  @CreateDateColumn({ name: 'deleted_at', type: 'datetime', precision: 6 }) deletedAt: Date;
  @Column({ type: 'varchar', length: 20, default: 'deleted' }) state: string;
}
