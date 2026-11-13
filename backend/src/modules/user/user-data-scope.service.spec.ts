import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserDataScopeService } from './user-data-scope.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */

const selfFlags = { viewSelf: 1, editSelf: 1, deleteSelf: 1 };

describe('数据范围配置：读侧与写侧共用一个拥有者', () => {
  let service: UserDataScopeService;
  let scopeRepo: any, targetRepo: any, userRepo: any, deptRepo: any, manager: any;

  beforeEach(() => {
    manager = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      save: jest.fn(async (_entity: any, data: any) => (Array.isArray(data) ? data.map((d: any, i: number) => ({ ...d, id: 200 + i })) : { ...data, id: 11 })),
      increment: jest.fn(),
    };
    scopeRepo = { find: jest.fn().mockResolvedValue([]), manager: { transaction: jest.fn(async (fn: any) => fn(manager)) } };
    targetRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { findOne: jest.fn().mockResolvedValue({ id: 1 }), find: jest.fn() };
    deptRepo = { find: jest.fn() };
    service = new UserDataScopeService(scopeRepo, targetRepo, userRepo, deptRepo);
  });

  it('loadForSession：无配置返回空数组（读侧对未配置表单按仅本人回退）', async () => {
    await expect(service.loadForSession(7)).resolves.toEqual([]);
  });

  it('loadForSession：行 + targets 映射，会话条目不携带行 id', async () => {
    scopeRepo.find.mockResolvedValue([
      { id: 11, scopeKey: 'example-items', scopeType: 'by_users', viewOthers: 1, editOthers: 1, deleteOthers: 0 },
    ]);
    targetRepo.find.mockResolvedValue([
      { userDataScopeId: 11, targetId: 7 },
      { userDataScopeId: 11, targetId: 8 },
      { userDataScopeId: 99, targetId: 1 },
    ]);
    await expect(service.loadForSession(7)).resolves.toEqual([
      { ...selfFlags, scopeKey: 'example-items', scopeType: 'by_users', viewOthers: 1, editOthers: 1, deleteOthers: 0, targets: [7, 8] },
    ]);
  });

  it('getPanelRows：无配置返回空数组，旧配置返回迁移提示而非六个开关', async () => {
    await expect(service.getPanelRows(1)).resolves.toEqual([]);
    scopeRepo.find.mockResolvedValue([{ id: 11, scopeKey: 'example-items', scopeType: 'all', viewOthers: 1, editOthers: 0, deleteOthers: 0 }]);
    await expect(service.getPanelRows(1)).resolves.toEqual([
      { id: 11, scopeKey: 'example-items', scopeType: 'all', legacyRestricted: true, targets: [] },
    ]);
  });

  it('getPanelRows：用户不存在时抛 404', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.getPanelRows(99)).rejects.toThrow(NotFoundException);
  });

  it('saveRows：未登记表单、非法类型或遗留 __global__ 行拒绝；重复表单拒绝', async () => {
    await expect(service.saveRows(1, [{ scopeKey: 'not-registered', scopeType: 'self' }], 1)).rejects.toThrow(BadRequestException);
    await expect(service.saveRows(1, [{ scopeKey: 'example-items', scopeType: 'wild' }], 1)).rejects.toThrow(BadRequestException);
    await expect(service.saveRows(1, [{ scopeKey: '__global__', scopeType: 'self' }], 1)).rejects.toThrow('不再支持所有表单默认值');
    await expect(
      service.saveRows(1, [
        { scopeKey: 'example-items', scopeType: 'self' },
        { scopeKey: 'example-items', scopeType: 'all' },
      ], 1),
    ).rejects.toThrow('数据范围表单不能重复');
  });

  it('saveRows：by_depts 目标必填且必须真实存在', async () => {
    await expect(
      service.saveRows(1, [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [] }], 1),
    ).rejects.toThrow('请指定数据范围目标');
    deptRepo.find.mockResolvedValue([]);
    await expect(
      service.saveRows(1, [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [5] }], 1),
    ).rejects.toThrow('数据范围包含不存在的目标');
  });

  it('saveRows：按表单全量替换落库并递增 tokenVersion，不补写 __global__ 遗留行', async () => {
    deptRepo.find.mockResolvedValue([{ id: 5 }]);
    const result = await service.saveRows(
      1,
      [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [5, 5] }],
      2,
    );
    expect(manager.delete).toHaveBeenCalled();
    const savedRows = manager.save.mock.calls.map((call: any[]) => call[1]).filter((d: any) => !Array.isArray(d));
    expect(savedRows.map((r: any) => r.scopeKey)).toEqual(['example-items']);
    expect(savedRows[0]).toMatchObject({ ...selfFlags, viewOthers: 1, editOthers: 1, deleteOthers: 1 });
    const targetBatches = manager.save.mock.calls.map((call: any[]) => call[1]).filter(Array.isArray);
    expect(targetBatches).toEqual([[{ userDataScopeId: 11, targetType: 'dept', targetId: 5, ownerId: 1, createdBy: 2 }]]);
    expect(manager.increment).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it.each(['viewSelf', 'editSelf', 'deleteSelf', 'viewOthers', 'editOthers', 'deleteOthers'])('旧载荷包含 %s 时拒绝，避免误切换规则', async key => {
    await expect(service.saveRows(1, [{ scopeKey: 'example-items', scopeType: 'self', [key]: 0 }], 2)).rejects.toThrow('只配置可见范围');
    expect(manager.delete).not.toHaveBeenCalled();
  });
});
