import { Entity, Column, Unique } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('user_data_scope_targets')
@Unique(['userDataScopeId', 'targetType', 'targetId'])
export class UserDataScopeTarget extends BaseEntity {
  @Column({ name: 'user_data_scope_id', type: 'int', comment: '关联 user_data_scopes.id' })
  userDataScopeId: number;

  @Column({ name: 'target_type', type: 'varchar', length: 20, comment: 'user / dept' })
  targetType: string;

  @Column({ name: 'target_id', type: 'int', comment: '用户ID 或 部门ID' })
  targetId: number;
}
