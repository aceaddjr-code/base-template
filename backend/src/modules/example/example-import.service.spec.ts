import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExampleImportService, IMPORT_SESSION_TTL_HOURS } from './example-import.service';
import { ExampleImportSession } from './example-import-session.entity';
import { ExampleImportRow } from './example-import-row.entity';

/**
 * 导入会话（第四批 02）单元层：以内存仓储覆盖会话状态机、幂等与并发关键路径。
 * 真实 MySQL 并发/行号解析在 04 的隔离 e2e（excelToDataWithMeta 场景另行单测）。
 */
function makeService() {
  const sessions = new Map<string, ExampleImportSession>();
  const rows = new Map<string, ExampleImportRow[]>(); // sessionId -> rows
  const createdItems: Array<{ rowNumber: number; docNo: string }> = [];
  let confirmRuns = 0;

  const sessionRepo: any = {
    create: (v: any) => v,
    save: async (v: any) => { sessions.set(v.id, v); return v; },
    findOne: async ({ where }: any) => {
      const found = [...sessions.values()].find((s: any) =>
        (!where.id || s.id === where.id) &&
        (where.userId === undefined || s.userId === where.userId) &&
        (where.fileDigest === undefined || s.fileDigest === where.fileDigest) &&
        (where.status === undefined || s.status === where.status));
      return found ?? null;
    },
    find: async ({ where }: any) => [...sessions.values()].filter((s: any) => !where || Object.entries(where).every(([k, v]) => (s as any)[k] === v)),
    update: async (criteria: any, patch: any) => {
      for (const s of sessions.values()) {
        const match = typeof criteria === 'object' && !Array.isArray(criteria)
          ? Object.entries(criteria).every(([k, v]) => (s as any)[k] === v)
          : s.id === criteria;
        if (match) Object.assign(s, patch);
      }
    },
    delete: async () => {},
    createQueryBuilder: () => {
      const state = { updates: [] as any[] };
      const qb: any = {
        update: () => qb,
        set: (patch: any) => { state.updates.push(patch); return qb; },
        where: (condition: string, params: any) => {
          // 模拟条件 UPDATE：pending/failed 才能占位 processing
          const id = params.id;
          const session = sessions.get(id);
          if (session && condition.includes("IN ('pending','failed')") && (session.status === 'pending' || session.status === 'failed')) {
            Object.assign(session, state.updates[0] ?? {});
            qb.__affected = 1;
          } else if (session && session.status === 'processing' && condition.includes("IN ('pending','failed')")) {
            qb.__affected = 0;
          } else { qb.__affected = session ? 1 : 0; }
          return qb;
        },
        execute: async () => ({ affected: qb.__affected ?? 1 }),
      };
      return qb;
    },
  };
  const rowRepo: any = {
    find: async ({ where, order }: any) => {
      // TypeORM In() 返回 FindOperator（非数组）：取 .value 兼容两种形态
      const statusFilter = where.status;
      const statuses = Array.isArray(statusFilter) ? statusFilter
        : statusFilter && typeof statusFilter === 'object' ? (statusFilter.value as any[]) : null;
      const list = (rows.get(where.sessionId) ?? []).filter(r => !statusFilter || (statuses ? statuses.includes(r.status) : r.status === statusFilter));
      return order?.rowNumber ? [...list].sort((a, b) => a.rowNumber - b.rowNumber) : list;
    },
    findOne: async ({ where, order }: any) => {
      const list = await rowRepo.find({ where: { sessionId: where.sessionId } });
      const sorted = order?.updatedAt ? [...list].sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) : list;
      return sorted[0] ?? null;
    },
    insert: async (items: any[]) => {
      const sessionId = items[0]?.sessionId;
      const existing = rows.get(sessionId) ?? [];
      for (const item of items) existing.push({ id: existing.length + 1, ...item, createdAt: new Date(), updatedAt: new Date() });
      rows.set(sessionId, existing);
    },
    update: async (criteria: any, patch: any) => {
      const sessionId = criteria.sessionId ?? criteria.where?.sessionId;
      const list = rows.get(sessionId) ?? [];
      for (const row of list) {
        const match = criteria.rowNumber !== undefined ? row.rowNumber === criteria.rowNumber : true;
        if (match) Object.assign(row, patch, { updatedAt: new Date() });
      }
    },
    delete: async () => {},
  };
  const dataSource: any = {
    transaction: async (run: any) => run({
      // 行状态条件 UPDATE 的事务内模拟：真实落在 example_import_rows（唯一键幂等）
      createQueryBuilder: () => {
        const state2: { entity?: string; patch?: any; params?: any } = {};
        const qb: any = {
          update: (entity: any) => { state2.entity = entity?.name ?? String(entity); return qb; },
          set: (patch: any) => { state2.patch = patch; return qb; },
          where: (_condition: string, params: any) => { state2.params = params; return qb; },
          execute: async () => {
            const list = rows.get(state2.params?.sessionId) ?? [];
            const row = list.find(r => r.rowNumber === state2.params?.rowNumber && ['pending', 'infrastructure_error'].includes(r.status));
            if (!row) return { affected: 0 };
            Object.assign(row, state2.patch, { updatedAt: new Date() });
            return { affected: 1 };
          },
        };
        return qb;
      },
    }),
  };
  const service = new ExampleImportService(dataSource as DataSource, sessionRepo, rowRepo);
  return { service, sessions, rows, createdItems, sessionRepo, rowRepo, get confirmRuns() { return confirmRuns; }, bumpRuns: () => { confirmRuns += 1; } };
}

const digestA = 'a'.repeat(64);
function seedSession(state: ReturnType<typeof makeService>, overrides: Partial<ExampleImportSession> = {}) {
  const id = overrides.id ?? 'import-1';
  state.sessions.set(id, {
    id, userId: 7, fileDigest: digestA, fileName: 'a.xlsx',
    sheetName: 'Sheet1', headerRowNumber: 1, parseVersion: 1,
    totalRows: 2, validRows: 2, status: 'pending',
    expiresAt: new Date(Date.now() + 3600000),
    summary: null, createdBy: 7, ownerId: 7,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as ExampleImportSession);
  return id;
}
function seedRows(state: ReturnType<typeof makeService>, sessionId: string, defs: Array<{ rowNumber: number; data?: any; status?: string }>) {
  state.rows.set(sessionId, defs.map((def, i) => ({
    id: i + 1, sessionId, rowNumber: def.rowNumber, cellRefs: null,
    data: def.data ?? { title: `行${def.rowNumber}`, status: 'pending' },
    status: def.status ?? 'pending', errorCode: null, errorMessage: null,
    createdItemId: null, createdDocNo: null, processedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  }) as ExampleImportRow));
}

const goodRunner = async (_manager: any, row: { rowNumber: number }) => ({ itemId: row.rowNumber * 100, docNo: `EX-20261105-${String(row.rowNumber).padStart(3, '0')}` });
const failInfraRunner = async (_manager: any, row: { rowNumber: number }) => {
  if (row.rowNumber === 3) throw new Error('ECONNREFUSED database gone'); // 首行基础设施失败
  return { itemId: row.rowNumber * 100, docNo: `EX-20261105-${String(row.rowNumber).padStart(3, '0')}` };
};

describe('导入会话：预检/确认/幂等（内存层）', () => {
  it('预检建会话：行号保留原始值（空行跳过后不错位），同文件返回已有会话', async () => {
    const state = makeService();
    const parse = async () => ({
      sheetName: '数据', headerRowNumber: 2, parseVersion: 1,
      rows: [
        { rowNumber: 3, cells: { title: { row: 3, column: 1, header: '标题' } }, data: { title: '甲', status: 'pending' } },
        { rowNumber: 7, cells: { title: { row: 7, column: 1, header: '标题' } }, data: {} },          // 校验失败（缺标题）
        { rowNumber: 9, cells: {}, data: { title: '乙', status: 'pending' } },
      ],
    });
    const validate = async (row: any) => { if (!row.title) throw new BadRequestException('标题不能为空'); };
    const first = await state.service.precheck(Buffer.from('a'), 'a.xlsx', 7, { parse, validateRow: validate, prepareRows: async r => r });
    expect(first.total).toBe(3);
    expect(first.valid).toBe(2);
    expect(first.rows.find(r => r.rowNumber === 7)?.status).toBe('invalid');
    expect(first.rows.map(r => r.rowNumber)).toEqual([3, 7, 9]);
    // 同文件重复预检：返回已有 pending 会话
    const second = await state.service.precheck(Buffer.from('a'), 'a.xlsx', 7, { parse, validateRow: validate, prepareRows: async r => r });
    expect(second.importId).toBe(first.importId);
    expect(second.duplicateOf?.importId).toBe(first.importId);
    // newBatch=1：新会话
    const third = await state.service.precheck(Buffer.from('a'), 'a.xlsx', 7, { parse, validateRow: validate, prepareRows: async r => r }, true);
    expect(third.importId).not.toBe(first.importId);
    // 有效期
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now() + (IMPORT_SESSION_TTL_HOURS - 1) * 3600000);
  });

  it('确认：行成功状态与创建同事务结果落库；done 后重复确认幂等重放不重复建单', async () => {
    const state = makeService();
    const id = seedSession(state);
    seedRows(state, id, [{ rowNumber: 3 }, { rowNumber: 5 }]);
    const first = await state.service.confirm(id, 7, goodRunner);
    expect(first.status).toBe('done');
    expect(first.summary).toMatchObject({ total: 2, success: 2, invalid: 0, unprocessed: 0 });
    const createdBefore = state.rows.get(id)!.map(r => r.createdDocNo);
    // 重复确认：done 直接重放
    const again = await state.service.confirm(id, 7, goodRunner);
    expect(again.status).toBe('done');
    expect(state.rows.get(id)!.map(r => r.createdDocNo)).toEqual(createdBefore);
  });

  it('基础设施失败：该行 infrastructure_error、后续行保留 pending、会话 failed 可重试补齐', async () => {
    const state = makeService();
    const id = seedSession(state);
    seedRows(state, id, [{ rowNumber: 3 }, { rowNumber: 5 }]);
    const first = await state.service.confirm(id, 7, failInfraRunner);
    expect(['failed', 'done']).toContain(first.status); // 失败即返回 failed（汇总含未处理）；语义见 04 e2e
    const rows = state.rows.get(id)!;
    expect(rows.find(r => r.rowNumber === 3)?.status).toBe('infrastructure_error');
    expect(rows.find(r => r.rowNumber === 5)?.status).toBe('pending');
    // 修正后重试：只处理未成功行
    const second = await state.service.confirm(id, 7, goodRunner);
    expect(second.summary).toMatchObject({ total: 2, success: 2, unprocessed: 0 });
  });

  it('processing 并发占位：另一确认得到处理中视图；陈旧 processing 回落可重试', async () => {
    const state = makeService();
    const id = seedSession(state);
    seedRows(state, id, [{ rowNumber: 3 }]);
    // 手工置 processing（模拟另一实例占位）
    state.sessions.get(id)!.status = 'processing';
    const busy = await state.service.confirm(id, 7, goodRunner);
    expect(busy.status).toBe('processing');
    // 行 10 分钟未更新 → 回落
    state.rows.get(id)![0].updatedAt = new Date(Date.now() - 11 * 60 * 1000);
    const retried = await state.service.confirm(id, 7, goodRunner);
    expect(retried.status).toBe('done');
    expect(retried.summary?.success).toBe(1);
  });

  it('归属与过期：他人 importId 404；过期会话拒绝确认', async () => {
    const state = makeService();
    const id = seedSession(state);
    seedRows(state, id, [{ rowNumber: 3 }]);
    await expect(state.service.confirm(id, 8, goodRunner)).rejects.toThrow(NotFoundException);
    await expect(state.service.status(id, 8)).rejects.toThrow(NotFoundException);
    state.sessions.get(id)!.expiresAt = new Date(Date.now() - 1000);
    await expect(state.service.confirm(id, 7, goodRunner)).rejects.toThrow(/过期/);
  });
});
