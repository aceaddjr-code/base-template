import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('departments')
export class Department extends BaseEntity {
  @Column({ type: 'varchar', length: 50, comment: '部门名称' })
  name: string;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '部门编码（英文小写或连字符）' })
  code: string;

  @Column({ name: 'parent_id', type: 'int', nullable: true, comment: '父部门ID（null=顶级）' })
  parentId: number | null;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=禁用' })
  status: number;

  @Column({ type: 'int', default: 0, comment: '排序（小的在前）' })
  sort: number;
}
