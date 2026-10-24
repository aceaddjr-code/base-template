import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserDataScopeService } from './user-data-scope.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */

const defaultRow = { scopeKey: '__global__', scopeType: 'self', viewOthers: 1, editOthers: 0, deleteOthers: 0, targets: [] as number[] };

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

  it('loadForSession：无配置回退 __global__ self（与面板兜底同口径）', async () => {
    await expect(service.loadForSession(7)).resolves.toEqual([defaultRow]);
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
      { scopeKey: 'example-items', scopeType: 'by_users', viewOthers: 1, editOthers: 1, deleteOthers: 0, targets: [7, 8] },
    ]);
  });

  it('getPanelRows：无配置补默认行（id: 0），有配置保留行 id 供编辑回显', async () => {
    await expect(service.getPanelRows(1)).resolves.toEqual([{ id: 0, ...defaultRow }]);
    scopeRepo.find.mockResolvedValue([{ id: 11, scopeKey: 'example-items', scopeType: 'all', viewOthers: 1, editOthers: 0, deleteOthers: 0 }]);
    await expect(service.getPanelRows(1)).resolves.toEqual([
      { id: 11, scopeKey: 'example-items', scopeType: 'all', viewOthers: 1, editOthers: 0, deleteOthers: 0, targets: [] },
    ]);
  });

  it('getPanelRows：用户不存在时抛 404', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.getPanelRows(99)).rejects.toThrow(NotFoundException);
  });

  it('saveRows：未登记表单或非法类型拒绝；重复表单拒绝', async () => {
    await expect(service.saveRows(1, [{ scopeKey: 'not-registered', scopeType: 'self' }], 1)).rejects.toThrow(BadRequestException);
    await expect(service.saveRows(1, [{ scopeKey: '__global__', scopeType: 'wild' }], 1)).rejects.toThrow(BadRequestException);
    await expect(
      service.saveRows(1, [
        { scopeKey: '__global__', scopeType: 'self' },
        { scopeKey: '__global__', scopeType: 'all' },
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

  it('saveRows：缺 __global__ 自动补齐，全量替换落库并递增 tokenVersion', async () => {
    deptRepo.find.mockResolvedValue([{ id: 5 }]);
    const result = await service.saveRows(
      1,
      [{ scopeKey: 'example-items', scopeType: 'by_depts', viewOthers: 1, targets: [5, 5] }],
      2,
    );
    expect(manager.delete).toHaveBeenCalled();
    const savedRows = manager.save.mock.calls.map((call: any[]) => call[1]).filter((d: any) => !Array.isArray(d));
    expect(savedRows.map((r: any) => r.scopeKey)).toEqual(['__global__', 'example-items']);
    const targetBatches = manager.save.mock.calls.map((call: any[]) => call[1]).filter(Array.isArray);
    expect(targetBatches).toEqual([[{ userDataScopeId: 11, targetType: 'dept', targetId: 5, ownerId: 1, createdBy: 2 }]]);
    expect(manager.increment).toHaveBeenCalled();
    expect(result).toEqual([{ id: 0, ...defaultRow }]);
  });
});
