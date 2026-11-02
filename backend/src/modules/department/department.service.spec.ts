import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DepartmentService } from './department.service';
import { Department } from './department.entity';
import { User } from '../user/user.entity';

function dept(id: number, name: string, parentId: number | null, code = `D${id}`): Department {
  return { id, name, code, parentId, status: 1, sort: 0 } as Department;
}

/** 公司(1) ─ 研发部(2) ─ 前端组(3)；公司(1) ─ 销售部(4) ─ 市场组(5) */
const fixture = () => [dept(1, '总公司', null), dept(2, '研发部', 1), dept(3, '前端组', 2), dept(4, '销售部', 1), dept(5, '市场组', 4)];

async function buildService(rows: Department[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    withDeleted: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ maxSeq: null }),
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (data) => ({ id: 99, ...data })),
  };
  const module = await Test.createTestingModule({
    providers: [
      DepartmentService,
      { provide: getRepositoryToken(Department), useValue: repo },
      { provide: getRepositoryToken(User), useValue: {} },
    ],
  }).compile();
  return { service: module.get(DepartmentService), qb, repo };
}

function ids(nodes: any[], path: number[] = []): number[][] {
  return nodes.flatMap((n) => {
    const here = [...path, n.id];
    return n.children?.length ? ids(n.children, here) : [here];
  });
}

describe('DepartmentService.findAll 关键词搜索保留祖先路径', () => {
  it('只命中叶子部门时，祖先链完整保留', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll('前端');
    expect(ids(tree)).toEqual([[1, 2, 3]]);
  });

  it('多个分支各自命中时互不丢失', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll('组');
    expect(ids(tree)).toEqual([[1, 2, 3], [1, 4, 5]]);
  });

  it('按编码命中同样保留路径', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll('d5');
    expect(ids(tree)).toEqual([[1, 4, 5]]);
  });

  it('关键词前后空白被裁剪后仍命中', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll(' 前端 ');
    expect(ids(tree)).toEqual([[1, 2, 3]]);
  });

  it('未命中任何节点时返回空树', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll('财务');
    expect(tree).toEqual([]);
  });

  it('无关键词时返回完整树', async () => {
    const { service } = await buildService(fixture());
    const tree = await service.findAll();
    expect(ids(tree)).toEqual([[1, 2, 3], [1, 4, 5]]);
  });
});

describe('DepartmentService.create 编码自动生成', () => {
  it('编码由系统生成（dept-0001 全局流水）并随其余字段规范化落库', async () => {
    const { service, repo } = await buildService([]);
    await service.create({ name: '新部门', parentId: 1 });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: '新部门', code: 'dept-0001', parentId: 1, status: 1, sort: 0 }));
  });

  it('编码在全局最大流水基础上递增（计数含软删行）', async () => {
    const { service, repo, qb } = await buildService([]);
    qb.getRawOne.mockResolvedValue({ maxSeq: 3 });
    await service.create({ name: '新部门' });
    expect(qb.withDeleted).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ code: 'dept-0004' }));
  });

  it('并发撞唯一索引时自动重新生成并重试成功', async () => {
    const { service, repo } = await buildService([]);
    const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    repo.save.mockRejectedValueOnce(dup);
    const result = await service.create({ name: '新部门' });
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ code: 'dept-0001' }));
  });

  it('重试用尽后原样抛出唯一索引错误', async () => {
    const { service, repo } = await buildService([]);
    const dup = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    repo.save.mockRejectedValue(dup);
    await expect(service.create({ name: '新部门' })).rejects.toBe(dup);
    expect(repo.save).toHaveBeenCalledTimes(3);
  });
});
