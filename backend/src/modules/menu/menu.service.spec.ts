import { MenuService } from './menu.service';

describe('菜单权限变更的会话失效', () => {
  it('修改权限码时在同一事务更新菜单和关联用户版本', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const manager = { query, getRepository: () => ({ update }) };
    const repo: any = {
      findOne: jest.fn().mockResolvedValue({ id: 5 }),
      manager: { transaction: async (fn: (value: any) => unknown) => fn(manager) },
    };
    await new MenuService(repo).update(5, { permission: 'items:view' });
    expect(update).toHaveBeenCalledWith(5, { permission: 'items:view' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('token_version'), [5, 5]);
  });

  it('仅修改显示名称时不使会话失效', async () => {
    const query = jest.fn();
    const manager = { query, getRepository: () => ({ update: jest.fn() }) };
    const repo: any = {
      findOne: jest.fn().mockResolvedValue({ id: 5 }),
      manager: { transaction: async (fn: (value: any) => unknown) => fn(manager) },
    };
    await new MenuService(repo).update(5, { name: '新名称' });
    expect(query).not.toHaveBeenCalled();
  });
});
