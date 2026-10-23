import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx-js-style';
import { ExampleService } from './example.service';
import { CrudBaseService } from '../../common/services/crud-base.service';
import { buildListQuery } from '../../common/utils/list-query';

function fixture() {
  const rows = [
    { id: 1, title: '目标甲', description: '第一行\n第二行', status: 'doing', updatedAt: new Date(2026, 9, 18, 8, 0) },
    { id: 2, title: '目标乙', description: null, status: 'pending', updatedAt: new Date(2026, 9, 18, 9, 0) },
    { id: 3, title: '其他', description: null, status: 'doing', updatedAt: new Date(2026, 9, 18, 10, 0) },
  ];
  const repo = { metadata: { hasColumnWithPropertyPath: (field: string) => ['status', 'createdAt', 'updatedAt'].includes(field) }, createQueryBuilder: jest.fn(() => {
    const predicates: Array<(row: any) => boolean> = [];
    let field = 'id', direction = 'DESC', offset = 0, limit = 50001;
    const query = {
      where: () => query,
      andWhere: (sql: string, params: any) => {
        if (sql.includes('selectedIds')) predicates.push(row => params.selectedIds.includes(row.id));
        else if (sql.includes(':kw')) predicates.push(row => `${row.title} ${row.description ?? ''}`.includes(params.kw.slice(1, -1)));
        else if (sql === 't.status = :status') predicates.push(row => row.status === params.status);
        else throw new Error(`未实现的查询条件：${sql}`);
        return query;
      },
      orderBy: (key: string, order: string) => { field = key.slice(2); direction = order; return query; },
      take: (value: number) => { limit = value; return query; },
      skip: (value: number) => { offset = value; return query; },
      getMany: async () => rows.filter(row => predicates.every(test => test(row))).sort((a, b) => {
        const compared = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
        return direction === 'ASC' ? compared : -compared;
      }).slice(offset, offset + limit),
      getManyAndCount: async () => [await query.getMany(), rows.filter(row => predicates.every(test => test(row))).length],
    };
    return query;
  }) };
  return { service: new ExampleService(repo as any), repo };
}
const admin = { sub: 1, roleCode: 'admin' };

describe('示例事项导出与批量删除', () => {
  it('筛选、选中与排序采用列表同一查询；导出按白名单去重并保留列顺序', async () => {
    const { service } = fixture();
    const query = { keyword: '目标', filters: { status: 'doing' }, ids: [1, 2, 3], sortBy: 'title', sortOrder: 'ASC' as const };
    expect((await service.list(query, admin)).list.map(row => row.id)).toEqual([1]);
    const exported = await service.exportExcel(admin, { ...query, cols: ['description', 'title', 'status', 'updatedAt', 'ownerId', 'title'] });
    const book = XLSX.read(exported.buffer, { type: 'buffer', cellDates: true, cellNF: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
    expect(values[0]).toEqual(['说明', '标题', '状态', '更新时间']);
    expect(values[1].slice(0, 3)).toEqual(['第一行\n第二行', '目标甲', '进行中']);
    expect(values).toHaveLength(2);
    expect(values[1][3]).toBeInstanceOf(Date);
    expect(sheet.D2.z).toBe('yyyy-mm-dd hh:mm:ss');
    expect(exported.filename).toContain('选中1条_');
  });

  it('无 cols 使用默认列表列；显式无有效列拒绝，不能回退导出其他列', async () => {
    const { service, repo } = fixture();
    await expect(service.exportExcel(admin, { cols: ['ownerId', 'actions'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    const exported = await service.exportExcel(admin);
    const book = XLSX.read(exported.buffer);
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets[book.SheetNames[0]], { header: 1 })[0]).toEqual(['标题', '状态', '类别', '说明', '更新时间']);
  });

  it('标准导出可重新导入，展示状态在模块内转换并继续执行创建验证', async () => {
    const { service } = fixture();
    const exported = await service.exportExcel(admin, { ids: [1] });
    const create = jest.spyOn(CrudBaseService.prototype, 'create').mockResolvedValue({ id: 4 });
    try {
      await expect(service.importFromExcel(exported.buffer, 1, admin)).resolves.toEqual({ imported: 1, total: 1, errors: [] });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '目标甲', status: 'doing', description: '第一行\n第二行' }), 1, admin);
    } finally { create.mockRestore(); }
  });

  it('超过 50000 条明确拒绝，不返回静默截断的文件', async () => {
    const { service, repo } = fixture();
    const oversized = { where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(), getMany: async () => Array(50001).fill({}) };
    repo.createQueryBuilder.mockReturnValue(oversized as any);
    await expect(service.exportExcel(admin)).rejects.toThrow('导出最多 50000 条');
  });

  it('批量去重、逐条复用单删；失败不回滚成功项且返回原因', async () => {
    const { service } = fixture();
    const remove = jest.spyOn(service, 'remove').mockImplementation(async id => {
      if (id === 2) throw new ForbiddenException('没有删除他人单据的权限');
      if (id === 3) throw new NotFoundException('记录不存在');
      return { success: true };
    });
    await expect(service.batchRemove([1, 2, 1, 3], admin)).resolves.toEqual({ successCount: 1, total: 3, failures: [{ id: 2, reason: '没有删除他人单据的权限' }, { id: 3, reason: '记录不存在' }] });
    expect(remove.mock.calls).toEqual([[1, admin], [2, admin], [3, admin]]);
  });

  it.each([[], [0], [-1], [1.5], ['1'], Array(501).fill(1)].map(ids => ({ ids })))('非法批量输入在任何删除前被拒绝', async ({ ids }) => {
    const { service } = fixture();
    const remove = jest.spyOn(service, 'remove');
    await expect(service.batchRemove(ids as number[], admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(remove).not.toHaveBeenCalled();
  });

  it('列表和导出解析器共用参数，非法 ids 不得被忽略而扩大为全量', () => {
    expect(buildListQuery({ query: { keyword: '目标', status: 'doing', ids: '2,1,2', cols: 'status,title' } } as any)).toMatchObject({ keyword: '目标', filters: { status: 'doing' }, ids: [2, 1], cols: ['status', 'title'] });
    for (const ids of ['', 'x', '1,,2', '0', '-1', '1.5', '9007199254740992', ['1']]) {
      expect(() => buildListQuery({ query: { ids } } as any)).toThrow(BadRequestException);
    }
  });
});
