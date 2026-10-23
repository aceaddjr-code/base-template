import { BadRequestException } from '@nestjs/common';

/** 日期按数据库保存的业务日历比较；结束日使用次日零点排他边界，包含毫秒。 */
export function dateRangeBounds(from?: string, to?: string) {
  function parse(value: string) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('日期必须为 YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1000-01-01' || value >= '9999-12-31') {
      throw new BadRequestException('日期无效或超出支持范围');
    }
    return date;
  }
  const first = from ? parse(from) : undefined;
  const last = to ? parse(to) : undefined;
  if (first && last && first > last) throw new BadRequestException('开始日期不能晚于结束日期');
  if (last) last.setUTCDate(last.getUTCDate() + 1);
  return { from: first ? `${from} 00:00:00` : undefined, before: last ? `${last.toISOString().slice(0, 10)} 00:00:00` : undefined };
}
