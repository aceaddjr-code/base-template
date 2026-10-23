import { CrudBaseService, CrudOptions } from './crud-base.service';

/** 最小具体子类：暴露 protected getFilterableWhitelist 供断言 */
class TestService extends CrudBaseService<any> {
  constructor(repo: any, options: CrudOptions = {}) {
    super(repo, {}, options);
  }
  whitelist() {
    return this.getFilterableWhitelist();
  }
}

function makeRepo(columns: string[]) {
  return {
    metadata: { hasColumnWithPropertyPath: (f: string) => columns.includes(f) },
  } as any;
}

describe('CrudBaseService 筛选白名单（2026-09-06 架构深化）', () => {
  it('白名单 = filterableFields ∪ inFilterable ∪ likeFilterableFields（自动并入去重）', () => {
    const svc = new TestService(makeRepo(['a', 'b', 'c', 'd']), {
      filterableFields: ['a', 'b'],
      inFilterable: ['b', 'c'],
      likeFilterableFields: ['d'],
    });
    expect(svc.whitelist().sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filterableFields 与 likeFilterableFields 存在交集 → 抛错（LIKE 会静默覆盖精确筛选）', () => {
    const svc = new TestService(makeRepo(['a', 'b']), {
      filterableFields: ['a'],
      likeFilterableFields: ['a', 'b'],
    });
    expect(() => svc.whitelist()).toThrow(/filterableFields\/inFilterable 与 likeFilterableFields/);
  });

  it('白名单字段不存在于实体 → 抛错（带模块名 + 错误字段名）', () => {
    const svc = new TestService(makeRepo(['a']), {
      filterableFields: ['a', 'notExist'],
    });
    expect(() => svc.whitelist()).toThrow(/TestService.*notExist/);
  });

  it('inFilterable/likeFilterableFields 里的错字段同样抛错', () => {
    const svc = new TestService(makeRepo(['a']), {
      filterableFields: ['a'],
      inFilterable: ['bad1'],
      likeFilterableFields: ['bad2'],
    });
    expect(() => svc.whitelist()).toThrow(/bad1.*bad2|bad2.*bad1/);
  });

  it('dateFilterableFields/numberFilterableFields 错字段抛错，但不并入精确筛选白名单', () => {
    const svc = new TestService(makeRepo(['a']), {
      filterableFields: ['a'],
      dateFilterableFields: ['badDate'],
    });
    expect(() => svc.whitelist()).toThrow(/badDate/);
    // 正常场景：日期字段合法时不并入
    const ok = new TestService(makeRepo(['a', 'reportDate']), {
      filterableFields: ['a'],
      dateFilterableFields: ['reportDate'],
    });
    expect(ok.whitelist()).toEqual(['a']);
  });

  it('未声明白名单 → 空（不抛错，精确筛选不生效）', () => {
    const svc = new TestService(makeRepo(['a', 'b']));
    expect(svc.whitelist()).toEqual([]);
  });

  it('校验结果缓存（第二次调用不再查 metadata）', () => {
    const hasColumnWithPropertyPath = jest.fn((f: string) => f === 'a');
    const svc = new TestService({ metadata: { hasColumnWithPropertyPath } } as any, { filterableFields: ['a'] });
    svc.whitelist();
    svc.whitelist();
    expect(hasColumnWithPropertyPath).toHaveBeenCalledTimes(1);
  });

  it('metadata 缺失（单测 mock 场景）→ 不校验直接返回', () => {
    const svc = new TestService({} as any, { filterableFields: ['a'] });
    expect(svc.whitelist()).toEqual(['a']);
  });

  it('metadata 存在但无 hasColumnWithPropertyPath（部分 mock 场景）→ 跳过校验不抛错', () => {
    const svc = new TestService({ metadata: {} } as any, { filterableFields: ['a'] });
    expect(svc.whitelist()).toEqual(['a']);
  });
});
