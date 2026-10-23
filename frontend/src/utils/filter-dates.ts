import dayjs from 'dayjs'

/** 快捷日期按中国业务日历；接口发送日期本身，不由浏览器转成 UTC 时间戳。 */
const DATE_RANGE_PRESETS: Record<string, { label: string; resolve: (today: dayjs.Dayjs) => [dayjs.Dayjs, dayjs.Dayjs] }> = {
  today: { label: '今天', resolve: (today) => [today, today] },
  'last-7-days': { label: '近 7 天', resolve: (today) => [today.subtract(6, 'day'), today] },
  'this-month': { label: '本月', resolve: (today) => [today.startOf('month'), today] },
}

function shanghaiToday(): dayjs.Dayjs {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return dayjs(date)
}

export function filterDatePresets() {
  const today = shanghaiToday()
  return Object.entries(DATE_RANGE_PRESETS).map(([, preset]) => ({ label: preset.label, value: preset.resolve(today) }))
}

const format = (value: dayjs.Dayjs) => value.format('YYYY-MM-DD')

/** 保存视图时识别相对日期语义：与今天计算的预设一致的区间返回稳定 key，否则 undefined（按具体日期保存）。 */
export function matchDateRangePreset(range: unknown): string | undefined {
  if (!Array.isArray(range) || range.length !== 2) return undefined
  const today = shanghaiToday()
  for (const [key, preset] of Object.entries(DATE_RANGE_PRESETS)) {
    const [from, to] = preset.resolve(today)
    if (range[0] === format(from) && range[1] === format(to)) return key
  }
  return undefined
}

/** 应用视图时把相对日期语义按当天重算；未知 key 返回 undefined。 */
export function resolveDateRangePreset(key: unknown): [string, string] | undefined {
  const preset = typeof key === 'string' ? DATE_RANGE_PRESETS[key] : undefined
  if (!preset) return undefined
  const [from, to] = preset.resolve(shanghaiToday())
  return [format(from), format(to)]
}
