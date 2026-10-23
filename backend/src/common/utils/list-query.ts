import type { Request } from 'express';
import { BadRequestException } from '@nestjs/common';
import type { ListQuery } from '../services/crud-base.service';

export function buildListQuery(req?: Request): ListQuery {
  const q = (req?.query ?? {}) as Record<string, any>;
  const csv = (value: unknown, name: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name}参数无效`);
    return value.split(',').map(part => part.trim());
  };
  const rawIds = csv(q.ids, '选中记录');
  if (rawIds && (rawIds.length > 500 || rawIds.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0))) {
    throw new BadRequestException('请选择 1 至 500 条有效记录');
  }
  const cols = csv(q.cols, '导出列');
  if (cols && (cols.length > 100 || cols.some(key => !/^[A-Za-z][\w]*$/.test(key) || key.length > 64))) {
    throw new BadRequestException('导出列参数无效');
  }
  const filters: Record<string, any> = {};
  for (const [key, value] of Object.entries(q)) {
    if (['page', 'pageSize', 'keyword', 'search', 'sortBy', 'sortOrder', 'mine', 'ids', 'cols'].includes(key)) continue;
    if (typeof value === 'string') {
      if (value !== '') filters[key] = value;
    } else if (value !== null && value !== undefined) {
      // 嵌套对象（filters[status]=x）或数组：原样透传，service 层按白名单消费
      filters[key] = value;
    }
  }
  return {
    page: q.page ? Number(q.page) : 1,
    pageSize: q.pageSize ? Number(q.pageSize) : 10,
    keyword: typeof q.keyword === 'string' ? q.keyword : typeof q.search === 'string' ? q.search : undefined,
    filters,
    mine: typeof q.mine === 'string' ? q.mine : undefined,
    sortBy: typeof q.sortBy === 'string' ? q.sortBy : undefined,
    sortOrder: typeof q.sortOrder === 'string' ? (q.sortOrder as 'ASC' | 'DESC') : undefined,
    ids: rawIds ? [...new Set(rawIds.map(Number))] : undefined,
    cols: cols ? [...new Set(cols)] : undefined,
  };
}
