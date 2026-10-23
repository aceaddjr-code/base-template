import { Entity, Column, ManyToMany, JoinTable } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Menu } from '../menu/menu.entity';

@Entity('roles')
export class Role extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true, comment: '角色名称' })
  name: string;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '角色编码' })
  code: string;

  @Column({ type: 'varchar', length: 200, nullable: true, comment: '角色描述' })
  description: string | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=禁用' })
  status: number;

  @ManyToMany(() => Menu)
  @JoinTable({
    name: 'role_menus',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'menu_id', referencedColumnName: 'id' },
  })
  menus: Menu[];
}
