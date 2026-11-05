import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 导入会话状态机：pending→processing→done/failed；过期置 expired（第四批 import-contract §3）。 */
export type ImportSessionStatus = 'pending' | 'processing' | 'done' | 'failed' | 'expired';

@Entity('example_import_sessions')
@Index('idx_import_sessions_user', ['userId', 'createdAt'])
@Index('idx_import_sessions_expiry', ['status', 'expiresAt'])
export class ExampleImportSession {
  @PrimaryColumn({ type: 'varchar', length: 36, comment: '导入会话 ID（importId）' })
  id: string;

  @Column({ name: 'user_id', type: 'int', comment: '创建者（授权主体）' })
  userId: number;

  @Column({ name: 'file_digest', type: 'char', length: 64, comment: 'SHA-256(文件)' })
  fileDigest: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255, comment: '原文件名（展示用）' })
  fileName: string;

  @Column({ name: 'sheet_name', type: 'varchar', length: 100, nullable: true, comment: '首个数据工作表名' })
  sheetName: string | null;

  @Column({ name: 'header_row_number', type: 'int', nullable: true, comment: '表头行（1 起）' })
  headerRowNumber: number | null;

  @Column({ name: 'parse_version', type: 'int', comment: '解析版本' })
  parseVersion: number;

  @Column({ name: 'total_rows', type: 'int', comment: '数据行总数' })
  totalRows: number;

  @Column({ name: 'valid_rows', type: 'int', comment: '预检通过行数' })
  validRows: number;

  @Column({ type: 'varchar', length: 20, default: 'pending', comment: 'pending/processing/done/failed/expired' })
  status: ImportSessionStatus;

  @Column({ type: 'json', nullable: true, comment: 'done 后聚合：success/invalid/unprocessed' })
  summary: Record<string, number> | null;

  @Column({ name: 'expires_at', type: 'datetime', comment: '会话有效期（预检+24h）' })
  expiresAt: Date;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy: number | null;

  @Column({ name: 'owner_id', type: 'int', nullable: true })
  ownerId: number | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
