import {
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Column,
} from 'typeorm';

/**
 * 所有数据库表的抽象基类
 *
 * 包含标准系统字段：
 * - id: 自增主键
 * - createdAt / updatedAt: 自动时间戳
 * - deletedAt: 软删除标记（NULL=未删除）
 * - createdBy / updatedBy: 操作人追踪
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @Column({ name: 'created_by', type: 'int', nullable: true, comment: '创建人ID' })
  createdBy: number | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true, comment: '最后修改人ID' })
  updatedBy: number | null;

  /**
   * 单据负责人ID（数据级权限隔离的归属字段）
   * 注意：只声明列，不在这里声明 owner 关系（避免 base → user 循环依赖导致
   * extends 求值期崩溃）；关系由各文档基类/实体单独声明（懒引用）。
   */
  @Column({ name: 'owner_id', type: 'int', nullable: true, comment: '单据负责人ID' })
  ownerId: number | null;
}
