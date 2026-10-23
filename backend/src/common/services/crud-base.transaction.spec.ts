import { CrudBaseService } from './crud-base.service';

/** 证明事务边界及执行顺序；真实数据库回滚另由 MySQL 集成用例验证。 */
describe('CRUD 主子表原子删除', () => {
  function fixture(failChild = false) {
    const rootDelete = jest.fn();
    const childRows = [{ id: 2, sourceId: 1, sourceType: 'test' }];
    const manager = {
      getRepository: jest.fn(() => ({ softDelete: jest.fn().mockResolvedValue({ affected: 1 }) })),
      find: jest.fn().mockResolvedValue(childRows),
      softRemove: jest.fn(async () => { if (failChild) throw new Error('child failed'); }),
    };
    const transaction = jest.fn(async work => work(manager));
    const repo = { target: 'parents', metadata: {}, softDelete: rootDelete, manager: { transaction }, findOne: jest.fn().mockResolvedValue({ id: 1 }) };
    const child = { target: 'children', metadata: {} };
    const service = new CrudBaseService(repo as any, { children: { repo: child as any, sourceKey: 'source_id', sourceType: 'test' } }, { dataScoped: false });
    return { service, manager, transaction, rootDelete, childRows };
  }
  it('主表与指定来源的子表均使用同一事务管理器，不调用根仓储写入', async () => {
    const { service, manager, transaction, rootDelete, childRows } = fixture();
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).toHaveBeenCalledWith('parents');
    expect(manager.find).toHaveBeenCalledWith('children', { where: { sourceId: 1, sourceType: 'test' } });
    expect(manager.softRemove).toHaveBeenCalledWith('children', childRows);
    expect(rootDelete).not.toHaveBeenCalled();
  });
  it('子表失败向事务传播，不能返回删除成功', async () => {
    const { service, rootDelete } = fixture(true);
    await expect(service.remove(1)).rejects.toThrow('child failed');
    expect(rootDelete).not.toHaveBeenCalled();
  });
});
