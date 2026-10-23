import { dateRangeBounds } from './date-range';

describe('业务日历日期区间', () => {
  it('结束日转为次日排他边界，包含最后一秒及其小数部分', () => {
    expect(dateRangeBounds('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01 00:00:00', before: '2026-11-01 00:00:00' });
    expect(dateRangeBounds(undefined, '2024-02-29').before).toBe('2024-03-01 00:00:00');
  });
  it.each(['2026-02-29', '2026-13-01', '2026-10-01T00:00:00Z', 'no-date', '9999-12-31'])('拒绝非法日期 %s', value => {
    expect(() => dateRangeBounds(value)).toThrow();
  });
  it('允许单端日期，但拒绝开始晚于结束', () => {
    expect(dateRangeBounds('2026-10-21')).toEqual({ from: '2026-10-21 00:00:00', before: undefined });
    expect(() => dateRangeBounds('2026-10-22', '2026-10-21')).toThrow('开始日期不能晚于结束日期');
  });
});
