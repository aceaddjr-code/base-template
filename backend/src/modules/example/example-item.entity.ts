import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('example_items')
export class ExampleItem extends BaseEntity {
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

  /** 乐观锁版本（F06）：客户端提交原值做条件更新，命中后由后端 +1；未提交 version 的调用方保持最后写入胜出 */
  @Column({ type: 'int', default: 1, comment: '乐观锁版本（F06）' })
  version: number;
}
