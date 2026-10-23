import { ValidationPipe } from '@nestjs/common';
import { CrudBaseService } from '../../common/services/crud-base.service';
import { dataToExcel } from '../../common/utils/excel-helper';
import * as XLSX from 'xlsx-js-style';
import { ExampleService } from './example.service';
import { DictService } from '../system/dict.service';
import { CreateExampleDto, UpdateExampleDto, validateExample } from './example.dto';

describe('示例事项输入规则', () => {
  const pipe = new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true });

  it.each([
    {}, {title:'   '}, {title:'x'.repeat(101)}, {title:'事项',status:'unknown'},
    {title:'事项',status:null}, {title:'事项',description:'x'.repeat(501)}, {title:'事项',ownerId:99},
  ])('HTTP 新增拒绝非法输入 %j', async input => {
    await expect(pipe.transform(input,{type:'body',metatype:CreateExampleDto})).rejects.toThrow();
  });

  it('新增去除标题首尾空格并采用默认状态', () => {
    expect(validateExample({title:'  事项  '})).toMatchObject({title:'事项',status:'pending'});
  });

  it('数据隔离模块缺少身份时在写入之前拒绝', async () => {
    const service = new ExampleService({} as any);
    await expect(service.create({title:'事项'})).rejects.toThrow('未登录');
    await expect(service.findOne(1)).rejects.toThrow('未登录');
  });

  it('部分更新不会把状态重置为默认值', () => {
    expect(validateExample({description:'新说明'},true).status).toBeUndefined();
    expect(() => validateExample({},true)).toThrow('没有可更新的字段');
    expect(() => validateExample({title:null},true)).toThrow();
  });

  it('HTTP 编辑拒绝空标题和非法状态', async () => {
    await expect(pipe.transform({title:''},{type:'body',metatype:UpdateExampleDto})).rejects.toThrow();
    await expect(pipe.transform({status:'unknown'},{type:'body',metatype:UpdateExampleDto})).rejects.toThrow();
  });

  it('Excel 导入复用业务规则，逐行返回错误且不写入非法状态', async () => {
    const service = new ExampleService({} as any);
    const create = jest.spyOn(CrudBaseService.prototype,'create').mockResolvedValue({id:1});
    try {
      const buffer = await dataToExcel([
        {title:'有效事项',status:'pending'}, {title:'无效事项',status:'unknown'},
      ],[{header:'标题',key:'title'},{header:'状态',key:'status'}]);
      const result = await service.importFromExcel(buffer,1,{sub:1});
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({ row: 3, message: '状态必须为 pending、doing 或 done' });
      expect(create).toHaveBeenCalledTimes(1);
    } finally { create.mockRestore(); }
  });
});


describe('示例事项类别字典规则（F40）', () => {
  function buildService(oldCategory: string | null, valueStatus: 'enabled' | 'disabled' | 'unknown') {
    const row = { id: 1, title: '事项', status: 'pending', category: oldCategory };
    const repo = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (data: any) => ({ ...row, ...data })),
    };
    const dictService = { getValueStatus: jest.fn().mockResolvedValue(valueStatus) };
    const service = new ExampleService(repo as any, dictService as any);
    return { service, repo, dictService, row };
  }

  it('新增选用启用中的类别通过', async () => {
    const { service } = buildService(null, 'enabled');
    const createSpy = jest.spyOn(CrudBaseService.prototype, 'create').mockResolvedValue({ id: 1 });
    try {
      await service.create({ title: '事项', category: 'cat-a' });
      expect(createSpy).toHaveBeenCalled();
    } finally { createSpy.mockRestore(); }
  });

  it('新增/改选停用中的类别拒绝并落到字段', async () => {
    const { service } = buildService(null, 'disabled');
    const error = await service.create({ title: '事项', category: 'cat-old' }).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.response.fieldErrors).toEqual([{ path: 'category', code: 'dict-disabled', message: '该类别已停用，请重新选择' }]);
  });

  it('原记录为停用类别且值未变时放行（回读判断，不信任前端原值）', async () => {
    const { service, repo } = buildService('cat-old', 'disabled');
    const updateSpy = jest.spyOn(CrudBaseService.prototype, 'update').mockResolvedValue({ id: 1 });
    try {
      await service.update(1, { title: '只改标题' });
      expect(updateSpy).toHaveBeenCalled();
      // 改选为另一个停用值:与原值不同 → 拒绝
      await expect(service.update(1, { title: '事项', category: 'cat-old2' })).rejects.toMatchObject({ status: 400 });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
    } finally { updateSpy.mockRestore(); }
  });

  it('清空类别是合法变更,不受停用限制', async () => {
    const { service } = buildService('cat-old', 'disabled');
    const updateSpy = jest.spyOn(CrudBaseService.prototype, 'update').mockResolvedValue({ id: 1 });
    try {
      await service.update(1, { title: '事项', category: null });
      expect(updateSpy).toHaveBeenCalled();
    } finally { updateSpy.mockRestore(); }
  });
});

describe('示例导入向导与类别导入（F30/F40）', () => {
  interface DictOption { label: string; value: string; status: number }

  function buildService(options: DictOption[]) {
    const create = jest.spyOn(CrudBaseService.prototype, 'create').mockResolvedValue({ id: 1 });
    const dictService = {
      getAllItemsByCode: jest.fn(async () => ({ code: 'item_category', name: '事项类别', options })),
      getValueStatus: jest.fn(async (_code: string, value: string) => {
        const option = options.find(o => o.value === value);
        return !option ? 'unknown' : option.status === 1 ? 'enabled' : 'disabled';
      }),
    };
    return { create, service: new ExampleService({} as any, dictService as any) };
  }

  /** 与导出文件同构:状态/类别列为展示标签,导入按标签翻译回内部值 */
  function importBuffer(rows: Array<Record<string, any>>) {
    return dataToExcel(rows, [
      { header: '标题', key: 'title' }, { header: '状态', key: 'status' },
      { header: '类别', key: 'category' }, { header: '说明', key: 'description' },
    ]);
  }

  afterEach(() => jest.restoreAllMocks());

  it('导入模板包含与导入列一致的表头', async () => {
    const buffer = await new ExampleService({} as any).importTemplateBuffer();
    const sheet = XLSX.read(buffer, { type: 'buffer' }).Sheets['Sheet1'];
    expect((XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][])[0]).toEqual(['标题', '状态', '类别', '说明']);
  });

  it('导入把状态与类别的展示标签翻译回内部值后写入', async () => {
    const { service, create } = buildService([{ label: '类别甲', value: 'cat-a', status: 1 }]);
    const buffer = await importBuffer([{ title: '事项', status: '待处理', category: '类别甲' }]);
    const result = await service.importFromExcel(buffer, 1, { sub: 1 });
    expect(result).toMatchObject({ imported: 1, total: 1, errors: [] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', category: 'cat-a' }), 1, { sub: 1 });
  });

  it('停用与未知类别按行报错且不写入', async () => {
    const { service, create } = buildService([
      { label: '类别甲', value: 'cat-a', status: 1 },
      { label: '类别乙', value: 'cat-old', status: 0 },
    ]);
    const buffer = await importBuffer([
      { title: '停用', status: '待处理', category: '类别乙' },
      { title: '未知', status: '待处理', category: '不存在' },
    ]);
    const result = await service.importFromExcel(buffer, 1, { sub: 1 });
    expect(result.imported).toBe(0);
    expect(result.errors).toEqual([
      { row: 2, message: '该类别已停用，请重新选择' },
      { row: 3, message: '类别不存在或已删除，请重新选择' },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it('预检按同一套规则返回统计与逐行错误,不写任何数据', async () => {
    const { service, create } = buildService([
      { label: '类别甲', value: 'cat-a', status: 1 },
      { label: '类别乙', value: 'cat-old', status: 0 },
    ]);
    const buffer = await importBuffer([
      { title: '可导入', status: '待处理', category: '类别甲' },
      { title: '', status: '待处理', category: '类别甲' },
      { title: '停用', status: '待处理', category: '类别乙' },
    ]);
    const result = await service.importPreview(buffer, 1, { sub: 1 });
    expect(result.total).toBe(3);
    expect(result.valid).toBe(1);
    expect(result.errors[0]).toEqual({ row: 3, message: expect.any(String) });
    expect(result.errors[1]).toEqual({ row: 4, message: '该类别已停用，请重新选择' });
    expect(create).not.toHaveBeenCalled();
  });

  it('已是内部值的类别原样通过翻译', async () => {
    const { service, create } = buildService([{ label: '类别甲', value: 'cat-a', status: 1 }]);
    const buffer = await importBuffer([{ title: '事项', status: 'pending', category: 'cat-a' }]);
    const result = await service.importFromExcel(buffer, 1, { sub: 1 });
    expect(result.imported).toBe(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', category: 'cat-a' }), 1, { sub: 1 });
  });
});

describe('示例事项乐观锁（F06）', () => {
  const admin = { sub: 1, roleCode: 'admin' };
  const pipe = new ValidationPipe({ transform:true, whitelist:true, forbidNonWhitelisted:true });

  function buildLockService(existing: any, affected: number) {
    const managerUpdate = jest.fn(async () => ({ affected }));
    const qb = { where: () => qb, andWhere: () => qb, getOne: async () => existing };
    const repo = {
      metadata: { target: 'example_items', hasColumnWithPropertyPath: (field: string) => field === 'ownerId' },
      createQueryBuilder: () => qb,
      manager: { transaction: async (fn: (m: any) => Promise<any>) => fn({ update: managerUpdate }) },
    };
    return { managerUpdate, service: new ExampleService(repo as any, { getValueStatus: async () => 'enabled' } as any) };
  }

  it('HTTP 编辑接受数字 version 并通过校验', async () => {
    await expect(pipe.transform({ title: 'x', version: 1 }, { type: 'body', metatype: UpdateExampleDto })).resolves.toBeTruthy();
    await expect(pipe.transform({ title: 'x', version: 'abc' }, { type: 'body', metatype: UpdateExampleDto })).rejects.toThrow();
  });

  it('提交 version 时按原子条件更新写入并把版本 +1', async () => {
    const existing = { id: 1, title: '旧标题', status: 'pending', version: 3, ownerId: null, category: null };
    const { managerUpdate, service } = buildLockService(existing, 1);
    await service.update(1, { title: '新标题', version: 3 }, 1, admin);
    expect(managerUpdate).toHaveBeenCalledTimes(1);
    const [target, criteria, patch] = managerUpdate.mock.calls[0];
    expect(target).toBe('example_items');
    expect(criteria).toEqual({ id: 1, version: 3 });
    expect(patch).toMatchObject({ title: '新标题', version: 4 });
  });

  it('版本已被他人推进时 0 行命中返回 409 且不写入', async () => {
    const existing = { id: 1, title: '别人的新标题', status: 'pending', version: 7, ownerId: null, category: null };
    const { managerUpdate, service } = buildLockService(existing, 0);
    const error = await service.update(1, { title: '我的旧草稿', version: 3 }, 1, admin).catch((e) => e);
    expect(error.status).toBe(409);
    expect(error.message).toContain('已被他人修改');
    expect(managerUpdate).toHaveBeenCalledTimes(1);
  });

  it('未提交 version 的调用方保持原最后写入胜出行为', async () => {
    const existing = { id: 1, title: '旧标题', status: 'pending', version: 3, ownerId: null, category: null };
    const { managerUpdate, service } = buildLockService(existing, 1);
    await service.update(1, { title: '直接改' }, 1, admin);
    const [target, criteria, patch] = managerUpdate.mock.calls[0];
    expect(target).toBe('example_items');
    expect(criteria).toBe(1);
    expect(patch).not.toHaveProperty('version');
  });
});
