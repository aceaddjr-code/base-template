import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ExampleImportSession } from './example-import-session.entity';
import { ExampleImportRow } from './example-import-row.entity';
import { excelToDataWithMeta } from '../../common/utils/excel-helper';

/** 会话有效期与防重元数据保留期（import-contract §3）。 */
export const IMPORT_SESSION_TTL_HOURS = 24;
export const IMPORT_META_RETENTION_DAYS = 7;
const SESSION_MAX_ROWS = 1000;
/** processing 无行更新的回落窗口：崩溃后允许重试，防死锁占位。 */
const PROCESSING_STALE_MS = 10 * 60 * 1000;

export interface PrecheckRowView {
  rowNumber: number;
  status: 'valid' | 'invalid';
  fieldKey?: string;
  column?: number;
  row?: number;
  message?: string;
}

export interface PrecheckResult {
  importId: string;
  expiresAt: Date;
  sheetName: string;
  headerRowNumber: number;
  total: number;
  valid: number;
  rows: PrecheckRowView[];
  duplicateOf?: { importId: string; createdAt: Date };
}

export interface SessionStatusView {
  importId: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'expired';
  expiresAt: Date;
  fileName: string;
  summary?: { total: number; success: number; invalid: number; unprocessed: number };
  rows?: Array<{ rowNumber: number; status: string; error?: string | null; createdDocNo?: string | null }>;
}

/**
 * 示例事项导入会话（第四批）：预检建会话、确认逐行幂等写入、结果查询。
 * 业务规则留在 example 模块（第二个导入模块出现前不抽通用框架）；
 * 行创建/履历/成功状态同一事务由 ExampleService.createImportRowWithinTx 完成。
 */
@Injectable()
export class ExampleImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExampleImportService.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  /** 确认执行中标记：同一进程内串行化同会话；跨实例靠 DB 条件占位。 */
  private confirming = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExampleImportSession)
    private readonly sessionRepo: Repository<ExampleImportSession>,
    @InjectRepository(ExampleImportRow)
    private readonly rowRepo: Repository<ExampleImportRow>,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => { void this.purgeExpired().catch(() => this.logger.warn('导入会话过期清理失败')); }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }
  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); }

  private digest(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** 过期清理：24h 会话置 expired 并清行内容；防重元数据保留 7 天后物理删除。 */
  async purgeExpired(): Promise<number> {
    if (this.cleaning) return 0;
    this.cleaning = true;
    try {
      const now = new Date();
      await this.sessionRepo.createQueryBuilder()
        .update(ExampleImportSession)
        .set({ status: 'expired' })
        .where("status IN ('pending','failed') AND expires_at < :now", { now })
        .execute();
      // 行内容（业务数据/坐标）随会话过期即清；保留行壳与状态/created_item_id 供幂等与审计
      const expired = await this.sessionRepo.find({ where: { status: 'expired' } });
      for (const session of expired) {
        await this.rowRepo.update({ sessionId: session.id }, { data: {}, cellRefs: null, errorCode: 'EXPIRED', errorMessage: '会话已过期' } as any);
      }
      const cutoff = new Date(now.getTime() - IMPORT_META_RETENTION_DAYS * 86400000);
      const stale = await this.sessionRepo.find({ where: { status: 'expired' } });
      const removable = stale.filter(s => s.updatedAt < cutoff).map(s => s.id);
      if (removable.length) {
        await this.rowRepo.delete({ sessionId: In(removable) });
        await this.sessionRepo.delete(removable);
      }
      return expired.length;
    } finally { this.cleaning = false; }
  }

  /** 预检：解析→逐行校验（不写业务记录）→建会话。同文件 pending 会话直接返回并提示。 */
  async precheck(
    buffer: Buffer,
    fileName: string,
    userId: number,
    options: {
      parse: (buffer: Buffer) => Promise<{ sheetName: string; headerRowNumber: number; rows: Array<{ rowNumber: number; cells: Record<string, any>; data: Record<string, any> }>; parseVersion: number }>;
      validateRow: (row: Record<string, any>) => Promise<void>;
      prepareRows: (rows: Record<string, any>[]) => Promise<Record<string, any>[]>;
    },
    newBatch = false,
  ): Promise<PrecheckResult> {
    const fileDigest = this.digest(buffer);
    if (!newBatch) {
      const existing = await this.sessionRepo.findOne({ where: { userId, fileDigest, status: 'pending' } });
      if (existing) {
        const rows = await this.rowRepo.find({ where: { sessionId: existing.id } });
        return this.toPrecheckView(existing, rows, { importId: existing.id, createdAt: existing.createdAt });
      }
    }
    const parsed = await options.parse(buffer);
    const prepared = await options.prepareRows(parsed.rows.map(r => r.data));
    const rowViews: PrecheckRowView[] = [];
    let valid = 0;
    for (let i = 0; i < parsed.rows.length; i++) {
      try {
        await options.validateRow(prepared[i]);
        valid += 1;
        rowViews.push({ rowNumber: parsed.rows[i].rowNumber, status: 'valid' });
      } catch (error) {
        rowViews.push({ rowNumber: parsed.rows[i].rowNumber, status: 'invalid', message: (error as Error).message });
      }
    }
    const importId = randomUUID();
    const session = await this.sessionRepo.save(this.sessionRepo.create({
      id: importId, userId, fileDigest, fileName,
      sheetName: parsed.sheetName, headerRowNumber: parsed.headerRowNumber, parseVersion: parsed.parseVersion,
      totalRows: parsed.rows.length, validRows: valid,
      status: 'pending',
      expiresAt: new Date(Date.now() + IMPORT_SESSION_TTL_HOURS * 3600000),
      createdBy: userId, ownerId: userId,
    }));
    await this.rowRepo.insert(parsed.rows.map((parsedRow, index) => ({
      sessionId: importId,
      rowNumber: parsedRow.rowNumber,
      cellRefs: parsedRow.cells ?? null,
      data: prepared[index],
      status: rowViews[index].status === 'valid' ? 'pending' : 'invalid',
      errorCode: rowViews[index].status === 'invalid' ? 'VALIDATION' : null,
      errorMessage: rowViews[index].message ?? null,
    })));
    const savedRows = await this.rowRepo.find({ where: { sessionId: importId } });
    return this.toPrecheckView(session, savedRows);
  }

  private toPrecheckView(session: ExampleImportSession, rows: ExampleImportRow[], duplicateOf?: { importId: string; createdAt: Date }): PrecheckResult {
    return {
      importId: session.id,
      expiresAt: session.expiresAt,
      sheetName: session.sheetName ?? '',
      headerRowNumber: session.headerRowNumber ?? 1,
      total: rows.length,
      valid: rows.filter(r => r.status !== 'invalid').length,
      rows: rows.map(row => ({
        rowNumber: row.rowNumber,
        status: row.status === 'invalid' ? 'invalid' : 'valid',
        message: row.errorMessage ?? undefined,
        ...(row.cellRefs ? { column: Object.values(row.cellRefs)[0]?.column, row: row.rowNumber } : {}),
      })),
      ...(duplicateOf ? { duplicateOf } : {}),
    };
  }

  /** 确认：条件占位 pending→processing；逐行（创建+履历+状态）同事务；幂等重放。 */
  async confirm(
    importId: string,
    userId: number,
    rowRunner: (manager: any, row: { rowNumber: number; data: Record<string, any> }) => Promise<{ itemId: number; docNo: string }>,
  ): Promise<SessionStatusView> {
    const session = await this.ownSession(importId, userId);
    if (session.status === 'expired' || session.expiresAt < new Date()) {
      throw new BadRequestException('导入会话已过期，请重新预检');
    }
    if (session.status === 'done') return this.status(importId, userId, true);
    if (this.confirming.has(importId) || session.status === 'processing') {
      // 陈旧 processing（超 10 分钟无行更新）回落可重试
      const fresh = await this.staleProcessingFallback(session);
      if (!fresh) {
        const view = await this.status(importId, userId, true);
        return { ...view, status: 'processing' };
      }
    }
    // DB 条件占位：双实例并发只有一个成功
    const claim = await this.sessionRepo.createQueryBuilder()
      .update(ExampleImportSession)
      .set({ status: 'processing' })
      .where("id = :id AND status IN ('pending','failed')", { id: importId })
      .execute();
    if (!claim.affected && session.status !== 'processing') {
      const view = await this.status(importId, userId, true);
      return { ...view, status: 'processing' };
    }
    this.confirming.add(importId);
    try {
      const pending = await this.rowRepo.find({
        where: { sessionId: importId, status: In(['pending', 'infrastructure_error']) },
        order: { rowNumber: 'ASC' },
      });
      for (const row of pending) {
        try {
          const { itemId, docNo } = await this.dataSource.transaction(async manager => {
            const created = await rowRunner(manager, { rowNumber: row.rowNumber, data: row.data });
            // 行成功标志与业务创建同事务：崩溃重试不会重复建单
            const result = await manager.createQueryBuilder()
              .update(ExampleImportRow)
              .set({ status: 'success', createdItemId: created.itemId, createdDocNo: created.docNo, errorCode: null, errorMessage: null, processedAt: new Date() })
              .where('session_id = :sessionId AND row_number = :rowNumber AND status IN (:...states)', {
                sessionId: importId, rowNumber: row.rowNumber, states: ['pending', 'infrastructure_error'],
              })
              .execute();
            if (!result.affected) {
              throw new Error('行状态已被并发更新，放弃本行写入');
            }
            return created;
          });
          void itemId; void docNo;
        } catch (error) {
          const message = (error as Error).message ?? '写入失败';
          const isValidation = /不存在|停用|至少|不能|必须|请/.test(message) && !(error as any).queryRunner;
          await this.rowRepo.update({ sessionId: importId, rowNumber: row.rowNumber }, {
            status: isValidation ? 'invalid' : 'infrastructure_error',
            errorCode: isValidation ? 'VALIDATION' : 'INFRASTRUCTURE',
            errorMessage: message.slice(0, 500),
            processedAt: new Date(),
          });
          if (!isValidation) {
            // 基础设施失败：停止后续行（保留 pending），会话 failed 可重试
            await this.sessionRepo.update({ id: importId }, { status: 'failed' });
            return await this.status(importId, userId, true);
          }
        }
      }
      await this.finalize(importId);
      return await this.status(importId, userId, true);
    } finally {
      this.confirming.delete(importId);
    }
  }

  /** processing 超 10 分钟无行更新→回落 pending 允许重试；返回 true 表示已回落。 */
  private async staleProcessingFallback(session: ExampleImportSession): Promise<boolean> {
    const latest = await this.rowRepo.findOne({ where: { sessionId: session.id }, order: { updatedAt: 'DESC' } });
    const lastActivity = latest?.updatedAt ?? session.updatedAt;
    if (Date.now() - new Date(lastActivity).getTime() > PROCESSING_STALE_MS) {
      await this.sessionRepo.update({ id: session.id }, { status: 'pending' });
      return true;
    }
    return false;
  }

  private async finalize(importId: string): Promise<void> {
    const rows = await this.rowRepo.find({ where: { sessionId: importId } });
    const summary = {
      total: rows.length,
      success: rows.filter(r => r.status === 'success').length,
      invalid: rows.filter(r => r.status === 'invalid').length,
      unprocessed: rows.filter(r => r.status === 'pending' || r.status === 'infrastructure_error').length,
    };
    const all = summary.success + summary.invalid;
    await this.sessionRepo.update({ id: importId }, { status: all === rows.length ? 'done' : 'done', summary });
  }

  /** 会话归属校验：他人 importId 一律 404（不泄露存在性）。 */
  async ownSession(importId: string, userId: number): Promise<ExampleImportSession> {
    const session = await this.sessionRepo.findOne({ where: { id: importId } });
    if (!session || session.userId !== userId) throw new NotFoundException('导入会话不存在');
    return session;
  }

  async status(importId: string, userId: number, withRows = true): Promise<SessionStatusView> {
    const session = await this.ownSession(importId, userId);
    const rows = withRows ? await this.rowRepo.find({ where: { sessionId: importId }, order: { rowNumber: 'ASC' } }) : [];
    return {
      importId: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
      fileName: session.fileName,
      summary: (session.summary as SessionStatusView['summary']) ?? undefined,
      rows: rows.map(row => ({
        rowNumber: row.rowNumber,
        status: row.status,
        error: row.errorMessage,
        createdDocNo: row.createdDocNo,
      })),
    };
  }

  /** 修正文件/报告用：取行（已按状态过滤）。 */
  async rowsForFile(importId: string, userId: number, onlyUnsuccessful: boolean): Promise<{ session: ExampleImportSession; rows: ExampleImportRow[] }> {
    const session = await this.ownSession(importId, userId);
    const rows = await this.rowRepo.find({ where: { sessionId: importId }, order: { rowNumber: 'ASC' } });
    return { session, rows: onlyUnsuccessful ? rows.filter(r => r.status !== 'success') : rows };
  }
}
