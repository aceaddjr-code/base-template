import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CrudBaseService, CrudOptions } from './crud-base.service';
import { ScopeUser, UserScopeEntry } from '../utils/data-scope';
import { excelToData } from '../utils/excel-helper';

type Row = { id: number; ownerId: number | null; title: string; deletedAt: null | Date };

class ScopedRecords extends CrudBaseService<Row> {
  protected dataScopeKey = 'example-items';

  constructor(repo: any, options: CrudOptions = {}) {
    super(repo, {}, {
      filterableFields: ['title'],
      excelColumns: [{ header: '标题', key: 'title' }],
      ...options,
    });
  }
}

/**
 * 只执行本组用例用到的谓词，遇到其他 SQL 就失败，避免静默放行。
 * 这是 CRUD interface 的仓储替身，不验证 MySQL SQL、软删映射或部门递归。
 */
function records(options: CrudOptions = {}, hasOwner = true) {
  const rows: Row[] = [
    { id: 1, ownerId: 2, title: '本人', deletedAt: null },
    { id: 2, ownerId: 7, title: '目标用户', deletedAt: null },
    { id: 3, ownerId: 9, title: '范围外', deletedAt: null },
    { id: 4, ownerId: null, title: '无归属', deletedAt: null },
  ];
  const find = (id: number) => rows.find(row => row.id === id && !row.deletedAt) ?? null;
  const manager = {
    update: jest.fn(async (_target: unknown, id: number, patch: Partial<Row>) => Object.assign(find(id)!, patch)),
    transaction: jest.fn(async (work: (manager: any) => Promise<unknown>) => work(manager)),
  };
  const repo = {
    metadata: { target: 'records', hasColumnWithPropertyPath: (field: string) => field === 'title' || (hasOwner && field === 'ownerId') },
    manager,
    createQueryBuilder: jest.fn(() => {
      const predicates: Array<(row: Row) => boolean> = [];
      let selected = '';
      const query = {
        where: (sql: string, params?: Record<string, any>) => {
          predicates.length = 0;
          return query.andWhere(sql, params);
        },
        andWhere: (sql: string, params: Record<string, any> = {}) => {
          if (sql === 't.deletedAt IS NULL') predicates.push(row => row.deletedAt === null);
          else if (sql === 't.id = :id') predicates.push(row => row.id === params.id);
          else if (sql === '1 = 0') predicates.push(() => false);
          else if (sql === 't.ownerId = :scopeUserId') predicates.push(row => row.ownerId === params.scopeUserId);
          else if (sql === 't.ownerId IN (:...scopeUserIds)') predicates.push(row => params.scopeUserIds.includes(row.ownerId));
          else if (sql === 't.title IS NOT NULL' || sql === "t.title != ''") predicates.push(row => !!row.title);
          else throw new Error(`仓储替身不支持该谓词: ${sql}`);
          return query;
        },
        select: (field: string) => { selected = field; return query; },
        groupBy: () => query,
        orderBy: () => query,
        skip: () => query,
        take: () => query,
        limit: () => query,
        getMany: async () => rows.filter(row => !row.deletedAt && predicates.every(predicate => predicate(row))),
        getOne: async () => (await query.getMany())[0] ?? null,
        getManyAndCount: async () => { const result = await query.getMany(); return [result, result.length]; },
        getRawMany: async () => (await query.getMany()).map(row => ({ v: row[selected.slice(2)] })),
      };
      return query;
    }),
    findOne: jest.fn(async ({ where }: { where: { id: number } }) => find(where.id)),
    softDelete: jest.fn(async (id: number) => { find(id)!.deletedAt = new Date(); }),
  };
  Object.assign(manager, { getRepository: jest.fn(() => repo) });
  return { service: new ScopedRecords(repo, options), repo, rows };
}

function user(scope: Partial<UserScopeEntry> = {}, extra: UserScopeEntry[] = []): ScopeUser {
  return { sub: 2, dataScopes: [{ scopeKey: 'example-items', scopeType: 'by_users', targets: [7], ...scope }, ...extra] };
}

describe('CrudBaseService 受限读取与当前操作（公开 interface 回归）', () => {
  it('缺少身份时 list、distinct、Excel 均不返回任何记录', async () => {
    const { service } = records();
    expect((await service.list({})).list).toEqual([]);
    expect(await service.distinctValues('title')).toEqual([]);
    const exported = await service.exportExcel();
    expect(await excelToData(exported.buffer, { title: ['标题'] })).toEqual([]);
  });

  it.each(['findOne', 'update', 'remove'] as const)('%s 缺少身份时拒绝且不写入', async operation => {
    const { service, repo } = records();
    const result = operation === 'update' ? service.update(1, { title: '变化' }) : service[operation](1);
    await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(repo.manager.transaction).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it.each(['findOne', 'update', 'remove'] as const)('%s 先限制范围，操作开关不能扩大目标集合', async operation => {
    const { service, repo } = records();
    const actor = user({ viewOthers: 1, editOthers: 1, deleteOthers: 1 });
    const result = operation === 'update' ? service.update(3, { title: '变化' }, 2, actor) : service[operation](3, actor);
    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.manager.transaction).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('列表、distinct、Excel 共享数据范围，列表可见不代表详情可见', async () => {
    const { service } = records();
    const actor = user({ viewOthers: 0 });
    expect((await service.list({}, actor)).list.map(row => row.title)).toEqual(['本人', '目标用户']);
    expect(await service.distinctValues('title', actor)).toEqual(['本人', '目标用户']);
    const exported = await service.exportExcel(actor);
    expect(await excelToData(exported.buffer, { title: ['标题'] })).toEqual([{ title: '本人' }, { title: '目标用户' }]);
    await expect(service.findOne(2, actor)).rejects.toThrow('没有查看他人单据的权限');
  });

  it.each([
    [0, 1, '编辑'], [1, 0, '查看'],
  ])('编辑他人需要 editOthers=%s 和 viewOthers=%s，拒绝发生在事务前', async (editOthers, viewOthers, text) => {
    const { service, repo, rows } = records();
    await expect(service.update(2, { title: '变化' }, 2, user({ editOthers, viewOthers }))).rejects.toThrow(`没有${text}他人单据的权限`);
    expect(repo.manager.transaction).not.toHaveBeenCalled();
    expect(rows[1].title).toBe('目标用户');
  });

  it('两个开关均允许时可编辑范围内他人，删除只使用独立开关', async () => {
    const { service, repo } = records();
    await expect(service.update(2, { title: '已修改' }, 2, user({ editOthers: 1, viewOthers: 1 }))).resolves.toMatchObject({ title: '已修改' });
    await expect(service.remove(2, user({ editOthers: 1, viewOthers: 1, deleteOthers: 0 }))).rejects.toThrow('没有删除他人单据的权限');
    expect(repo.softDelete).not.toHaveBeenCalled();
    await expect(service.remove(2, user({ editOthers: 0, viewOthers: 0, deleteOthers: 1 }))).resolves.toEqual({ success: true });
    expect(repo.softDelete).toHaveBeenCalledWith(2);
  });

  it('无配置时仅本人，操作开关不会阻止本人的查看编辑删除', async () => {
    const { service } = records();
    const actor = { sub: 2, roleCode: 'custom_admin' };
    expect((await service.list({}, actor)).list.map(row => row.id)).toEqual([1]);
    await expect(service.findOne(2, actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(1, actor)).resolves.toMatchObject({ id: 1 });
    await expect(service.update(1, { title: '本人更新' }, 2, actor)).resolves.toMatchObject({ title: '本人更新' });
    await expect(service.remove(1, actor)).resolves.toEqual({ success: true });
  });

  it('表单范围及操作开关优先全局，缺少表单配置时回退全局', async () => {
    const { service, repo } = records();
    const global: UserScopeEntry = { scopeKey: '__global__', scopeType: 'all', viewOthers: 1, editOthers: 1, deleteOthers: 1 };
    const actor = user({ scopeType: 'self', viewOthers: 0 }, [global]);
    await expect(service.findOne(2, actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(2, user({ scopeType: 'all', viewOthers: 0 }, [global]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne(3, { sub: 2, dataScopes: [global] })).resolves.toMatchObject({ id: 3 });
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it.each(['findOne', 'update', 'remove'] as const)('%s 对无归属记录仅允许系统管理员', async operation => {
    const { service } = records();
    const actor = user({ scopeType: 'all', viewOthers: 1, editOthers: 1, deleteOthers: 1 });
    const run = (acting: ScopeUser) => operation === 'update' ? service.update(4, { title: '已更新' }, 2, acting) : service[operation](4, acting);
    await expect(run(actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run({ sub: 1, roles: ['admin'] })).resolves.toBeDefined();
  });

  it('负责人修改规则保留，普通用户不能转移，管理员可转移', async () => {
    const { service, repo } = records();
    await expect(service.update(1, { ownerId: 7 }, 2, user())).rejects.toThrow('只有系统管理员可以修改单据负责人');
    expect(repo.manager.transaction).not.toHaveBeenCalled();
    await expect(service.update(1, { ownerId: 2, title: '未转移' }, 2, user())).resolves.toMatchObject({ ownerId: 2 });
    await expect(service.update(1, { ownerId: 7 }, 1, { sub: 1, roles: ['admin'] })).resolves.toMatchObject({ ownerId: 7 });
  });

  it('dataScoped=false 保留无需身份的读写，但修改负责人仍要求管理员', async () => {
    const { service, repo } = records({ dataScoped: false });
    await expect(service.findOne(3)).resolves.toMatchObject({ id: 3 });
    await expect(service.update(3, { ownerId: 2 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update(3, { title: '配置修改' })).resolves.toMatchObject({ title: '配置修改' });
    await expect(service.remove(3)).resolves.toEqual({ success: true });
    expect(repo.findOne).toHaveBeenCalled();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('未声明 ownerId 时保留范围查询，但不增加操作开关裁决', async () => {
    const { service } = records({}, false);
    const actor = user({ scopeType: 'all', viewOthers: 0, editOthers: 0, deleteOthers: 0 });
    await expect(service.findOne(2, actor)).resolves.toMatchObject({ id: 2 });
    await expect(service.update(2, { title: '已修改' }, 2, actor)).resolves.toMatchObject({ title: '已修改' });
    await expect(service.remove(2, actor)).resolves.toEqual({ success: true });
  });
});
