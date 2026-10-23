import { generateDocNo, generateDocNoBatch } from './doc-no-generator';

describe('generateDocNo', () => {

  function mockRepo(maxSeq: number | null) {
    const qb: any = {
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maxSeq }),
    };
    return {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
  }

  function todayPart(): string {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  it('应生成当日第一条流水号 001（无历史记录）', async () => {
    const repo = mockRepo(null);
    const result = await generateDocNo('XMLH', repo as any, 'docNo');
    expect(result).toBe(`XMLH-${todayPart()}-001`);
  });

  it('应在最大流水号基础上 +1', async () => {
    const repo = mockRepo(3);
    const result = await generateDocNo('XMLH', repo as any, 'docNo');
    expect(result).toBe(`XMLH-${todayPart()}-004`);
  });

  it('流水号应左侧补零到 3 位', async () => {
    const repo = mockRepo(9);
    const result = await generateDocNo('XMLH', repo as any, 'docNo');
    expect(result).toBe(`XMLH-${todayPart()}-010`);
  });

  it('不同前缀流水号独立计数', async () => {
    const repo1 = mockRepo(5);
    const repo2 = mockRepo(null);

    const r1 = await generateDocNo('XMLH', repo1 as any, 'docNo');
    const r2 = await generateDocNo('QDH', repo2 as any, 'docNo');

    expect(r1).toBe(`XMLH-${todayPart()}-006`);
    expect(r2).toBe(`QDH-${todayPart()}-001`);
  });

  it('取最大流水而非 id 倒序最新（doc_no 被编辑/id 乱序不重号）', async () => {
    // 存量最大流水 003（即使 id 更大的记录流水被改小，聚合口径仍返回 3）
    const repo = mockRepo(3);
    const result = await generateDocNo('XMLH', repo as any, 'docNo');
    expect(result).toBe(`XMLH-${todayPart()}-004`);
  });
});

describe('generateDocNoBatch', () => {
  function mockRepo(maxSeq: number | null) {
    const qb: any = {
      withDeleted: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maxSeq }),
    };
    return {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
  }

  it('应从最大流水 +1 起返回 count 个连续单据号（一次聚合查询）', async () => {
    const repo = mockRepo(3) as any;
    const result = await generateDocNoBatch('RW', repo, 'docNo', 4);
    const p = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
    expect(result).toEqual([`RW-${p}-004`, `RW-${p}-005`, `RW-${p}-006`, `RW-${p}-007`]);
    // 只查一次（批量性能口径：1 条 SQL，非逐条 N 条）
    expect(repo.createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('无历史记录时应从 001 起', async () => {
    const repo = mockRepo(null) as any;
    const result = await generateDocNoBatch('RW', repo, 'docNo', 2);
    const p = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
    expect(result).toEqual([`RW-${p}-001`, `RW-${p}-002`]);
  });
});
