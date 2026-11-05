import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SettingService } from './setting.service';
import { SysSetting } from './entities/sys-setting.entity';
import { SystemLogService } from './system-log.service';

/** 内存仓储模拟 sys_settings（第六批：boolean 规范化/组合校验/修订号 409/事务审计）。 */
function makeService(initial: Array<{ key: string; value: string; revision?: number }> = []) {
  const rows = new Map<number, SysSetting>();
  let nextId = 1;
  for (const item of initial) rows.set(nextId, { id: nextId++, key: item.key, value: item.value, revision: item.revision ?? 0, createdAt: new Date(), updatedAt: new Date() } as SysSetting);
  const audits: any[] = [];
  const repo: any = {
    find: async () => [...rows.values()],
    findOne: async ({ where }: any) => [...rows.values()].find(r => r.key === where?.key) ?? null,
    manager: {
      find: async () => [...rows.values()],
      findOne: async (...args: any[]) => {
        // manager.findOne(Entity, { where }) — 两参形式；repo.findOne({ where }) — 单参形式
        const where = args.length >= 2 ? args[1]?.where : args[0]?.where;
        return [...rows.values()].find(r => r.key === where?.key) ?? null;
      },
      update: async (entity: any, id: number, patch: any) => {
        const row = rows.get(id);
        if (!row) return;
        if (typeof patch.revision === 'function') row.revision = (row.revision ?? 0) + 1;
        else Object.assign(row, patch, { updatedAt: new Date() });
      },
      save: async (entity: any, data: any) => {
        const saved = { id: nextId++, revision: 0, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.set(saved.id, saved as SysSetting);
        return saved;
      },
      transaction: async (run: any) => run({
        find: async () => repo.manager.find(),
        findOne: repo.manager.findOne,
        update: repo.manager.update,
        save: repo.manager.save,
      }),
    },
  };
  const logService: any = { write: jest.fn(), writeInTransaction: jest.fn(async (_m: any, entry: any) => { audits.push(entry); }) };
  const service = new SettingService(repo, logService);
  return { service, rows, audits, logService };
}

const ADMIN = { sub: 1, username: 'admin' };

describe('系统参数（第六批）：类型校验、组合约束与修订号', () => {
  it('boolean 规范化：仅接受 true/false（大小写容忍），非法值拒绝；listPublic 默认关闭', async () => {
    const { service } = makeService();
    const initial = await service.listPublic();
    expect(initial['maintenance.notice.enabled']).toBe('false'); // 默认关闭
    expect(initial['maintenance.notice.message']).toBe('');
    // 合法布尔
    await service.updateBatch([{ key: 'maintenance.notice.enabled', value: 'True' }, { key: 'maintenance.notice.message', value: '计划维护' }], ADMIN, 0);
    const updated = await service.listPublic();
    expect(updated['maintenance.notice.enabled']).toBe('true');
    // 非法布尔
    await expect(service.updateValue('maintenance.notice.enabled', 'yes', ADMIN, 1)).rejects.toThrow(BadRequestException);
    await expect(service.updateValue('maintenance.notice.enabled', '1', ADMIN, 1)).rejects.toThrow(BadRequestException);
  });

  it('组合校验：启用时内容必须非空（批量合并后判定；单键不能绕过）', async () => {
    const { service } = makeService();
    // DEBUG: check revision
    const listResult = await service.listAll();
    // 批量：启用＋空内容 → 拒绝
    await expect(service.updateBatch([
      { key: 'maintenance.notice.enabled', value: 'true' },
      { key: 'maintenance.notice.message', value: '' },
    ], ADMIN, 0)).rejects.toThrow('内容不能为空');
    // 单键绕过：先设内容，启用，再单键清空内容 → 拒绝
    await service.updateBatch([
      { key: 'maintenance.notice.enabled', value: 'true' },
      { key: 'maintenance.notice.message', value: '维护中' },
    ], ADMIN, 0);
    await expect(service.updateValue('maintenance.notice.message', '  ', ADMIN, 1)).rejects.toThrow('内容不能为空');
    // 关闭时清空内容允许
    await service.updateBatch([
      { key: 'maintenance.notice.enabled', value: 'false' },
      { key: 'maintenance.notice.message', value: '' },
    ], ADMIN, 1);
  });

  it('批量校验：重复键/未知键拒绝；超长文本拒绝', async () => {
    const { service } = makeService();
    await expect(service.updateBatch([
      { key: 'site.name', value: 'A' },
      { key: 'site.name', value: 'B' },
    ], ADMIN)).rejects.toThrow('重复');
    await expect(service.updateBatch([{ key: 'unknown.key', value: 'x' }], ADMIN, 0)).rejects.toThrow(NotFoundException);
    await expect(service.updateValue('maintenance.notice.message', 'x'.repeat(301), ADMIN, 0)).rejects.toThrow('最多');
  });

  it('修订号乐观并发：baseRevision 不匹配 409（含当前修订号）；事务审计', async () => {
    const { service, audits } = makeService([{ key: 'site.name', value: 'A', revision: 3 }]);
    // 正确版本提交成功；审计与变更同事务
    await service.updateBatch([{ key: 'help.contact', value: 'admin@x' }], ADMIN, 3);
    expect(audits.length).toBe(1);
    // 旧版本 → 409
    const error: any = await service.updateBatch([{ key: 'site.name', value: 'B' }], ADMIN, 3).catch(e => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'settings_stale' });
    // 值未被覆盖
    const current = await service.listAll();
    expect(current.list.find(item => item.key === 'site.name')?.value).toBe('A');
  });

  it('既有文本参数兼容：required/maxLength/trim 语义不变', async () => {
    const { service } = makeService();
    await expect(service.updateValue('site.name', '', ADMIN, 0)).rejects.toThrow('不能为空');
    await expect(service.updateValue('site.name', 'x'.repeat(51), ADMIN, 0)).rejects.toThrow('最多');
    const view = await service.updateValue('site.name', '  新平台  ', ADMIN, 0);
    expect(view.value).toBe('新平台');
  });
});
