import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 示例事项团队成员子表：单据上的多选用户字段（example-fields 的 memberIds）。
 * 成员身份提供记录可见性（数据范围的额外可见分支，见 example-member-visibility.ts），
 * 能执行什么操作仍由成员角色的权限码裁决——本表不存储任何权限。
 * 刻意不继承 BaseEntity（无归属人语义）；软删列用于编辑时的全量替换，恢复单据无需还原成员行。
 */
@Entity('example_item_members')
@Index('ix_example_member_item', ['itemId'])
@Index('ix_example_member_user', ['userId'])
export class ExampleItemMember {
  @PrimaryGeneratedColumn() id: number;

  /** 所属单据（example_items.id）；不加 (item_id, user_id) 唯一键：软删后重加同一人会撞键，去重由服务层负责 */
  @Column({ name: 'item_id', type: 'int' }) itemId: number;

  @Column({ name: 'user_id', type: 'int' }) userId: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 }) createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 }) updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 6 }) deletedAt: Date | null;

  @Column({ name: 'created_by', type: 'int', nullable: true, comment: '创建人ID' })
  createdBy: number | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true, comment: '最后修改人ID' })
  updatedBy: number | null;
}
