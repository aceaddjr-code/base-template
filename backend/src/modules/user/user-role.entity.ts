import { Entity, Column, Unique } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('user_roles')
@Unique(['userId', 'roleId'])
export class UserRole extends BaseEntity {
  @Column({ name: 'user_id', type: 'int', comment: '用户ID' })
  userId: number;

  @Column({ name: 'role_id', type: 'int', comment: '角色ID' })
  roleId: number;
}
