import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** 只记录启用回收站后的删除批次；恢复后移除，历史软删不补录。 */
@Entity('example_recycle')
export class ExampleRecycle {
  @PrimaryColumn({ name: 'item_id', type: 'int' }) itemId: number;
  @Column({ name: 'attachment_ids', type: 'json' }) attachmentIds: number[];
  @Column({ name: 'deleted_by', type: 'int' }) deletedBy: number;
  @Column({ name: 'actor_name', type: 'varchar', length: 50 }) actorName: string;
  @CreateDateColumn({ name: 'deleted_at', type: 'datetime', precision: 6 }) deletedAt: Date;
  @Column({ type: 'varchar', length: 20, default: 'deleted' }) state: string;
}

/** 永久占号，不保存被清除单据的正文。 */
@Entity('example_reserved_numbers')
export class ExampleReservedNumber {
  @PrimaryColumn({ name: 'doc_no', type: 'varchar', length: 32 }) docNo: string;
}
