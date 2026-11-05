import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PermissionExplanationService } from './permission-explanation.service';
import { EXPLAIN_REASONS } from '../user/permission-explanation.contracts';

/**
 * 权限效果解释分层矩阵（单测层）：按 action-map §2 顺序逐层短路。
 * SQL 范围判定以 qb 桩表达（真 SQL 的部门子树区分性在隔离 MySQL e2e 验证）。
 */
function setup(options: {
  entry?: Record<string, unknown> | null;
  record?: { id: number; ownerId: number | null; deletedAt?: Date | null } | null;
  inScope?: boolean;
  codes?: string[];
  roles?: string[];
  target?: Record<string, unknown>;
}) {
  const userRepo: any = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where?.id === 1) return options.target ?? { id: 1, username: 'alice', displayName: '用户甲', status: 1, mustChangePassword: 0, tokenVersion: 3, roleId: 2, deptId: 10 };
      if (where?.id === 77) return { id: 77, username: 'owner', displayName: '归属人' };
      return null;
    }),
    find: jest.fn(async () => [{ id: 7, username: 'peer', displayName: '同事' }]),
    manager: { query: jest.fn(async () => [
      { roleId: 2, roleCode: 'user', roleName: '普通用户', roleStatus: 1, permission: 'example-items:view' },
      { roleId: 9, roleCode: 'ghost', roleName: '已停用角色', roleStatus: 0, permission: 'example-items:update' },
    ]) },
  };
  const deptRepo: any = { find: jest.fn(async () => [{ id: 20, name: '部门甲' }]) };
  const exampleRepo: any = {
    findOne: jest.fn(async () => options.record === undefined ? { id: 50, docNo: 'EX-20261104-001', title: '事项', ownerId: 1, deletedAt: null } : options.record),
    createQueryBuilder: jest.fn(() => {
      const qb: any = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis() };
      qb.getRawOne = jest.fn(async () => (options.inScope === undefined || options.inScope ? { id: 50 } : undefined));
      return qb;
    }),
  };
  const authService: any = {
    buildEffectiveIdentity: jest.fn(async () => ({ roles: options.roles ?? ['user'], roleIds: [2], dataScopes: options.entry === undefined ? [{ scopeKey: 'example-items', scopeType: 'self', targets: [] }] : options.entry ? [options.entry] : [] })),
    getUserAccessCodes: jest.fn(async () => options.codes ?? ['example-items:view', 'example-items:update', 'example-items:delete', 'example-items:export']),
  };
  const logService: any = { write: jest.fn(async () => undefined) };
  const service = new PermissionExplanationService(userRepo, deptRepo, exampleRepo, authService, logService);
  return { service, logService };
}

const caller = { sub: 0, username: 'admin' };
const resultsOf = async (service: PermissionExplanationService, recordId: number | null = 50) => {
  const response = await service.explain(1, 'example-items', recordId, caller);
  return Object.fromEntries((response.recordEvaluation ?? []).map((item) => [item.action, item]));
};

describe('权限效果解释：分层矩阵', () => {
  it('本人记录＋默认开关＋全权限码：五动作 allowed，update 附乐观锁提示', async () => {
    const { service } = setup({});
    const results = await resultsOf(service);
    for (const action of ['list', 'detail', 'delete', 'export'] as const) expect(results[action].result).toBe('allowed');
    expect(results.update.result).toBe('allowed');
    expect(results.update.reasonCodes).toEqual([EXPLAIN_REASONS.OPTIMISTIC_LOCK]);
  });

  it('他人记录仅开查看：detail/export 放行，update/delete OTHERS_SWITCH_OFF', async () => {
    const { service } = setup({ record: { id: 50, ownerId: 77, deletedAt: null }, entry: { scopeKey: 'example-items', scopeType: 'by_users', viewOthers: 1, editOthers: 0, deleteOthers: 0, targets: [77] } });
    const results = await resultsOf(service);
    expect(results.detail.result).toBe('allowed');
    expect(results.export.result).toBe('allowed');
    expect(results.update.reasonCodes).toEqual([EXPLAIN_REASONS.OTHERS_SWITCH_OFF]);
    expect(results.delete.reasonCodes).toEqual([EXPLAIN_REASONS.OTHERS_SWITCH_OFF]);
  });

  it('viewSelf=0：列表可见但详情/导出/编辑被拒（编辑落 EDIT_REQUIRES_VIEW）', async () => {
    const { service } = setup({ entry: { scopeKey: 'example-items', scopeType: 'self', viewSelf: 0 } });
    const results = await resultsOf(service);
    expect(results.list.result).toBe('allowed');
    expect(results.detail.reasonCodes).toEqual([EXPLAIN_REASONS.SELF_SWITCH_OFF]);
    expect(results.export.reasonCodes).toEqual([EXPLAIN_REASONS.SELF_SWITCH_OFF]);
    expect(results.update.reasonCodes).toEqual([EXPLAIN_REASONS.EDIT_REQUIRES_VIEW]);
    expect(results.delete.result).toBe('allowed');
  });

  it('admin 系统例外：全 allowed＋ADMIN_EXCEPTION', async () => {
    const { service } = setup({ roles: ['admin'], record: { id: 50, ownerId: 77, deletedAt: null } });
    const response = await service.explain(1, 'example-items', { id: 50 }, caller);
    for (const item of response.recordEvaluation!) {
      expect(item.result).toBe('allowed');
      expect(item.reasonCodes).toContain(EXPLAIN_REASONS.ADMIN_EXCEPTION);
    }
    expect(response.operationPermissions.every((item) => item.adminException && item.effective)).toBe(true);
  });

  it('无归属人记录：仅管理员可操作 → NO_OWNER_RECORD', async () => {
    const { service } = setup({ record: { id: 50, ownerId: null, deletedAt: null } });
    const results = await resultsOf(service);
    expect(results.detail.reasonCodes).toEqual([EXPLAIN_REASONS.NO_OWNER_RECORD]);
    expect(results.update.reasonCodes).toEqual([EXPLAIN_REASONS.NO_OWNER_RECORD]);
    expect(results.list.result).toBe('allowed');
  });

  it('软删除记录：全部 RECORD_NOT_FOUND，不泄露区分', async () => {
    const { service } = setup({ record: { id: 50, ownerId: 1, deletedAt: new Date('2026-11-01T00:00:00Z') } });
    const response = await service.explain(1, 'example-items', { id: 50 }, caller);
    expect(response.record?.deleted).toBe(true);
    for (const item of response.recordEvaluation!) expect(item.reasonCodes).toEqual([EXPLAIN_REASONS.RECORD_NOT_FOUND]);
  });

  it('共同范围不含记录（同款 SQL 判定）：RECORD_NOT_FOUND', async () => {
    const { service } = setup({ inScope: false });
    const results = await resultsOf(service);
    for (const action of Object.keys(results)) expect(results[action].reasonCodes).toEqual([EXPLAIN_REASONS.RECORD_NOT_FOUND]);
  });

  it('缺少动作权限码：OPERATION_PERMISSION_MISSING 优先于范围与开关', async () => {
    const { service } = setup({ codes: ['example-items:view'] });
    const results = await resultsOf(service);
    expect(results.update.reasonCodes).toEqual([EXPLAIN_REASONS.OPERATION_PERMISSION_MISSING]);
    expect(results.detail.result).toBe('allowed');
  });

  it('账号层短路：禁用与待改密分别 ACCOUNT_DISABLED / ACCOUNT_MUST_CHANGE_PASSWORD', async () => {
    const disabled = setup({ target: { id: 1, username: 'a', displayName: 'A', status: 0, mustChangePassword: 0, tokenVersion: 1, roleId: 2 } });
    const r1 = await resultsOf(disabled.service);
    for (const key of Object.keys(r1)) expect(r1[key].reasonCodes).toEqual([EXPLAIN_REASONS.ACCOUNT_DISABLED]);
    const pending = setup({ target: { id: 1, username: 'a', displayName: 'A', status: 1, mustChangePassword: 1, tokenVersion: 1, roleId: 2 } });
    const r2 = await resultsOf(pending.service);
    for (const key of Object.keys(r2)) expect(r2[key].reasonCodes).toEqual([EXPLAIN_REASONS.ACCOUNT_MUST_CHANGE_PASSWORD]);
  });

  it('附件表单记录级一律 unsupported；摘要可用且 fallback 语义正确', async () => {
    const { service } = setup({});
    const response = await service.explain(1, 'attachments', { id: 50 }, caller);
    expect(response.configSource.scopeFormLabel).toBe('附件管理');
    for (const item of response.recordEvaluation!) {
      expect(item.result).toBe('unsupported');
      expect(item.reasonCodes).toEqual([EXPLAIN_REASONS.UNSUPPORTED_ACTION]);
    }
    // 未配置表单：回退仅本人
    const fallback = setup({ entry: null });
    const summary = await fallback.service.explain(1, 'attachments', null, caller);
    expect(summary.dataScope.scopeType).toBe('fallback_self');
    expect(summary.configSource.fallback).toBe('self_only');
    expect(summary.recordEvaluation).toBeNull();
  });

  it('权限来源含停用角色并标记启用状态；审计只记目标/表单/是否查询记录', async () => {
    const { service, logService } = setup({});
    const response = await service.explain(1, 'example-items', { id: 50 }, caller);
    const view = response.operationPermissions.find((item) => item.action === 'detail')!;
    expect(view.sources).toEqual([expect.objectContaining({ roleCode: 'user', roleEnabled: true })]);
    const updatePerm = response.operationPermissions.find((item) => item.action === 'update')!;
    expect(updatePerm.effective).toBe(true); // getUserAccessCodes 口径
    expect(updatePerm.sources).toEqual([expect.objectContaining({ roleCode: 'ghost', roleEnabled: false })]);
    const entry = logService.write.mock.calls[0][0];
    expect(entry).toMatchObject({ entityType: 'users', entityId: 1 });
    expect(JSON.parse(entry.detail)).toEqual({ event: 'permission_explain', scopeKey: 'example-items', recordQueried: true });
  });

  it('单据编号与数字 ID 等价定位同一条记录', async () => {
    const { service } = setup({});
    // 桩按 where.docNo 命中同一条记录
    const byNo = await service.explain(1, 'example-items', { docNo: 'EX-20261104-001' }, caller);
    expect(byNo.record?.docNo).toBe('EX-20261104-001');
    for (const item of byNo.recordEvaluation!) expect(item.result).toBe('allowed');
  });

  it('非法表单与不存在目标明确拒绝', async () => {
    const { service } = setup({});
    await expect(service.explain(1, 'not-registered', null, caller)).rejects.toThrow(BadRequestException);
    const missing = setup({ target: null });
    await expect(missing.service.explain(999, 'example-items', null, caller)).rejects.toThrow(NotFoundException);
  });
});
