import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
@Index('idx_notif_user_read', ['userId', 'readAt'])
@Index('idx_notif_type_biz', ['type', 'bizId'])
@Index('uniq_notif_source', ['sourceKey'], { unique: true })
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  /** 接收人用户 ID */
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  /** 通知类型（由调用方定义） */
  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** 调用方定义的关联记录类型。 */
  @Column({ name: 'biz_type', type: 'varchar', length: 50, nullable: true })
  bizType: string | null;

  /** 关联单据 ID（跳转详情用） */
  @Column({ name: 'biz_id', type: 'int', nullable: true })
  bizId: number | null;

  /** 已读时间（null = 未读） */
  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt: Date | null;

  /** 来源唯一键 type:event_id:recipient_id（第五批幂等）；旧数据 NULL。 */
  @Column({ name: 'source_key', type: 'varchar', length: 120, nullable: true, comment: '来源唯一键，旧数据 NULL' })
  sourceKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
