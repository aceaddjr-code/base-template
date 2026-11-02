import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('example_items')
export class ExampleItem extends BaseEntity {
  /** 单据编号：创建时由后端生成（EX-yyyymmdd-001），全库唯一且不可修改；软删行仍占用序号。 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '单据编号（唯一，系统生成）' })
  docNo: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, comment: '标题' })
  title: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending', comment: '状态' })
  status: string;

  /** 字典驱动字段（item_category，F40）：存量停用值允许保留，新增/改选仅限启用项 */
  @Column({ type: 'varchar', length: 50, nullable: true, comment: '类别（字典 item_category）' })
  category: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '说明' })
  description: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null;

  /** 本模块修改必须提交加载时版本；事务内锁定旧值并核对，真实变化才 +1。 */
  @Column({ type: 'int', default: 1, comment: '乐观锁版本（F06）' })
  version: number;
}
