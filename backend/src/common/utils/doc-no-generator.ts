import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';

export interface DocNoOptions {
  /** 日期段位数：8 = yyyyMMdd 按日归零（默认）；6 = yymmdd 按 yymm 当月归零；0 = 无日期段，全局流水不归零 */
  dateDigits?: number;
  /** 流水位数：3 = 001（默认）；2 = 01 */
  seqDigits?: number;
}

interface DocNoContext {
  datePart: string;
  likePrefix: string;
  dateDigits: number;
  seqDigits: number;
}

/** 组装 datePart 与归零 LIKE 前缀（单条/批量共用） */
function buildDocNoContext(prefix: string, opts: DocNoOptions): DocNoContext {
  const { dateDigits = 8, seqDigits = 3 } = opts;

  const today = new Date();
  const y = String(today.getFullYear());
  const yy = y.slice(2);
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');

  // 6 位日期（yymmdd，按当月归零）；8 位日期（yyyyMMdd，按日归零）；0 位无日期（全局流水不归零）
  const datePart = dateDigits === 0 ? '' : dateDigits === 6 ? `${yy}${m}${d}` : `${y}${m}${d}`;
  // 归零口径：6 位 → 当月前缀 prefix-yymm%（yymmdd 连续 6 位，当月全部记录均以 prefix-yymm 开头）；
  // 8 位 → 当日前缀 prefix-yyyymmdd-%；0 位 → 全局前缀 prefix-%
  const likePrefix = dateDigits === 0 ? `${prefix}-%` : dateDigits === 6 ? `${prefix}-${yy}${m}%` : `${prefix}-${datePart}-%`;
  return { datePart, likePrefix, dateDigits, seqDigits };
}

/** 组装完整编号：有日期段 → prefix-datePart-seq；无日期段 → prefix-seq */
function assembleDocNo(prefix: string, datePart: string, seq: number, seqDigits: number): string {
  return `${prefix}${datePart ? `-${datePart}` : ''}-${String(seq).padStart(seqDigits, '0')}`;
}

/**
 * 查当日/当月已生成的最大流水号；无记录返回 0。
 * withDeleted()：软删记录仍占用唯一索引（doc_no 唯一），序号必须包含软删记录才能避免冲突
 */
async function currentMaxSeq(
  repo: Repository<any>,
  field: string,
  likePrefix: string,
  seqDigits: number,
): Promise<number> {
  const row = await repo
    .createQueryBuilder('e')
    .withDeleted()
    .where(`e.${field} LIKE :pattern`, { pattern: likePrefix })
    .select(`MAX(CAST(SUBSTRING(e.${field}, -${seqDigits}) AS UNSIGNED))`, 'maxSeq')
    .getRawOne();
  const n = Number(row?.maxSeq);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function generateDocNo(
  prefix: string,
  repo: Repository<any>,
  field: string,
  opts: DocNoOptions = {},
): Promise<string> {
  const logger = new Logger('DocNoGenerator');
  const { datePart, likePrefix, dateDigits, seqDigits } = buildDocNoContext(prefix, opts);

  const seq = (await currentMaxSeq(repo, field, likePrefix, seqDigits)) + 1;

  const maxSeq = Math.pow(10, seqDigits) - 1;
  if (seq > maxSeq) {
    logger.warn(`${prefix} ${dateDigits === 0 ? '全局' : dateDigits === 6 ? '当月' : '今日'}流水号已超过 ${maxSeq}`);
  }

  return assembleDocNo(prefix, datePart, seq, seqDigits);
}

export async function generateDocNoBatch(
  prefix: string,
  repo: Repository<any>,
  field: string,
  count: number,
  opts: DocNoOptions = {},
): Promise<string[]> {
  const { datePart, likePrefix, seqDigits } = buildDocNoContext(prefix, opts);
  const max = await currentMaxSeq(repo, field, likePrefix, seqDigits);
  return Array.from({ length: count }, (_, i) => assembleDocNo(prefix, datePart, max + 1 + i, seqDigits));
}
