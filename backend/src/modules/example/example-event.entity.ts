import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 单据事实只追加；刻意不继承软删除、自动更新时间或业务归属列。 */
@Entity('example_events')
@Index('uq_example_event_intent', ['actorId', 'interactionId'], { unique: true })
@Index('ix_example_event_document', ['itemId', 'occurredAt', 'id'])
export class ExampleEvent {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'item_id', type: 'int' }) itemId: number;
  @Column({ type: 'varchar', length: 20 }) action: string;
  @Column({ type: 'varchar', length: 20 }) result: string;
  @Column({ name: 'object_label', type: 'varchar', length: 100 }) objectLabel: string;
  @Column({ name: 'actor_id', type: 'int' }) actorId: number;
  @Column({ name: 'actor_name', type: 'varchar', length: 50 }) actorName: string;
  @CreateDateColumn({ name: 'occurred_at', type: 'datetime', precision: 6 }) occurredAt: Date;
  @Column({ type: 'varchar', length: 20 }) source: string;
  @Column({ name: 'request_id', type: 'varchar', length: 100, nullable: true }) requestId: string | null;
  @Column({ name: 'interaction_id', type: 'varchar', length: 64, charset: 'ascii', collation: 'ascii_bin', nullable: true }) interactionId: string | null;
  @Column({ name: 'batch_id', type: 'varchar', length: 36, nullable: true }) batchId: string | null;
  @Column({ name: 'row_number', type: 'int', nullable: true }) rowNumber: number | null;
  @Column({ type: 'int' }) version: number;
}

@Entity('example_changes')
@Index('ix_example_change_event', ['eventId', 'id'])
export class ExampleChange {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'event_id', type: 'int' }) eventId: number;
  @Column({ name: 'field_key', type: 'varchar', length: 50 }) fieldKey: string;
  @Column({ name: 'field_label', type: 'varchar', length: 50 }) fieldLabel: string;
  @Column({ name: 'value_type', type: 'varchar', length: 20 }) valueType: string;
  @Column({ name: 'before_value', type: 'json', nullable: true }) beforeValue: unknown;
  @Column({ name: 'after_value', type: 'json', nullable: true }) afterValue: unknown;
  @Column({ name: 'before_label', type: 'text', nullable: true }) beforeLabel: string | null;
  @Column({ name: 'after_label', type: 'text', nullable: true }) afterLabel: string | null;
}
