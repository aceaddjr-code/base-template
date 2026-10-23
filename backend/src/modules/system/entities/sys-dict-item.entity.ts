import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { SysDictType } from './sys-dict-type.entity';

/** 数据字典选项表（一个类型下多个选项，含标签颜色） */
@Entity('sys_dict_items')
@Index(['typeId', 'sort'])
export class SysDictItem extends BaseEntity {
  @Column({ name: 'type_id', type: 'int', comment: '所属字典类型ID' })
  typeId: number;

  @ManyToOne(() => SysDictType, { nullable: true })
  @JoinColumn({ name: 'type_id' })
  type: SysDictType | null;

  @Column({ type: 'varchar', length: 50, comment: '选项显示值（下拉框看到的文字）' })
  label: string;

  @Column({ type: 'varchar', length: 50, comment: '选项存储值（存进业务表的字段值）' })
  value: string;

  @Column({ type: 'varchar', length: 30, nullable: true, comment: '标签颜色（antd 预设名：processing/success/warning/error/default）' })
  color: string | null;

  @Column({ type: 'int', default: 0, comment: '排序（小的在前）' })
  sort: number;

  @Column({ type: 'tinyint', default: 1, comment: '1=启用 0=停用' })
  status: number;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null;
}
