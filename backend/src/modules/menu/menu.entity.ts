import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('menus')
export class Menu extends BaseEntity {
  @Column({ name: 'parent_id', type: 'int', nullable: true, comment: '父级菜单ID' })
  parentId: number | null;

  @Column({ type: 'varchar', length: 50, comment: '菜单名称' })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true, comment: '前端路由路径' })
  path: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '图标名称' })
  icon: string | null;

  @Column({ type: 'varchar', length: 20, default: 'menu', comment: 'menu=菜单 button=按钮' })
  type: string;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '按钮权限标识' })
  permission: string | null;

  @Column({ type: 'int', default: 0, comment: '排序' })
  sort: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=禁用' })
  status: number;
}
