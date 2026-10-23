import { Entity, Column, Unique } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('user_data_scopes')
@Unique(['userId', 'scopeKey'])
export class UserDataScope extends BaseEntity {
  @Column({ name: 'user_id', type: 'int', comment: '用户ID（users.id）' })
  userId: number;

  /**
   * 表单标识，与按钮权限码前缀同源；__global__ 表示所有表单默认配置。
   */
  @Column({ name: 'scope_key', type: 'varchar', length: 50, comment: '表单标识，__global__=所有表单默认' })
  scopeKey: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 20, comment: '数据范围：self/all/by_users/by_depts' })
  scopeType: string;

  @Column({ name: 'view_others', type: 'tinyint', default: 1, comment: '查看他人单据详情（0/1）' })
  viewOthers: number;

  @Column({ name: 'edit_others', type: 'tinyint', default: 0, comment: '编辑他人单据（0/1）' })
  editOthers: number;

  @Column({ name: 'delete_others', type: 'tinyint', default: 0, comment: '删除他人单据（0/1）' })
  deleteOthers: number;
}
