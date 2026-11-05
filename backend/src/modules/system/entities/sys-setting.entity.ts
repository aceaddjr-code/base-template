import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

/** 系统参数：仅存储预登记键的当前取值；名称/类型/可见性/说明以代码注册表为准。 */
@Entity('sys_settings')
export class SysSetting extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'setting_key', type: 'varchar', length: 100, comment: '参数键，如 site.name（须先在 setting-registry 登记）' })
  key: string;

  @Column({ type: 'varchar', length: 500, comment: '参数值（按注册表类型的字符串形式存储）' })
  value: string;

  /** 全局参数修订号：任一参数更新递增（乐观并发，第六批）；行取值仅以 0 为起点。 */
  @Column({ type: 'int', default: 0, comment: '全局参数修订号，任一更新递增' })
  revision: number;
}
