import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity('system_logs')
export class SystemLog extends BaseEntity {
  @Column({ name: 'user_id', type: 'int', nullable: true, comment: '操作人ID' })
  userId: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '操作人用户名（冗余）' })
  username: string | null;

  @Column({ type: 'varchar', length: 30, comment: '操作类型：create|update|delete|export|import|login|view' })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 50, nullable: true, comment: '操作实体类型' })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'int', nullable: true, comment: '操作记录ID' })
  entityId: number | null;

  @Column({ name: 'entity_desc', type: 'varchar', length: 200, nullable: true, comment: '操作记录描述，如单据编号' })
  entityDesc: string | null;

  @Column({ type: 'text', nullable: true, comment: '操作详情 JSON：{ old, new, filters, count, ... }' })
  detail: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '操作IP地址' })
  ip: string | null;
}
