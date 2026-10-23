import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SysDictItem } from './sys-dict-item.entity';

@Entity('sys_dict_types')
export class SysDictType extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50, comment: '类型编码，如 item_category（英文小写下划线）' })
  code: string;

  @Column({ type: 'varchar', length: 50, comment: '类型名称，如：事项类别' })
  name: string;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=停用（停用后下拉不再返回）' })
  status: number;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null;

  @OneToMany(() => SysDictItem, (item) => item.type)
  items: SysDictItem[];
}
