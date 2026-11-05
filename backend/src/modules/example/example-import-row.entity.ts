import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 行终态：pending→success/invalid/infrastructure_error；权限收回的未处理行保持 pending（报告呈现 unprocessed）。 */
export type ImportRowStatus = 'pending' | 'success' | 'invalid' | 'infrastructure_error';

@Entity('example_import_rows')
@Index('uniq_import_session_row', ['sessionId', 'rowNumber'], { unique: true })
@Index('idx_import_rows_status', ['sessionId', 'status'])
export class ExampleImportRow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', type: 'varchar', length: 36, comment: '关联会话' })
  sessionId: string;

  /** 原始 Excel 行号（1 起）＝行唯一标识；幂等键 (sessionId, rowNumber)。 */
  @Column({ name: 'row_number', type: 'int', comment: '原始 Excel 行号（1 起）' })
  rowNumber: number;

  @Column({ type: 'json', nullable: true, comment: 'key->原始单元格坐标（报告/标红）' })
  cellRefs: Record<string, { row: number; column: number; header: string }> | null;

  @Column({ type: 'json', comment: '服务端保存的规范化行数据' })
  data: Record<string, any>;

  @Column({ type: 'varchar', length: 30, default: 'pending', comment: 'pending/success/invalid/infrastructure_error' })
  status: ImportRowStatus;

  @Column({ name: 'error_code', type: 'varchar', length: 50, nullable: true, comment: 'VALIDATION/PERMISSION/DICT/INFRASTRUCTURE/EXPIRED' })
  errorCode: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true, comment: '可读原因' })
  errorMessage: string | null;

  @Column({ name: 'created_item_id', type: 'int', nullable: true, comment: '成功单据 ID（幂等证据）' })
  createdItemId: number | null;

  @Column({ name: 'created_doc_no', type: 'varchar', length: 32, nullable: true, comment: '成功单据编号' })
  createdDocNo: string | null;

  @Column({ name: 'processed_at', type: 'datetime', nullable: true, comment: '行裁决时间' })
  processedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
