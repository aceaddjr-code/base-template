import dayjs from 'dayjs'
import { h } from 'vue'

/** 今日日期（YYYY-MM-DD，本地时区）：页头"今日"展示共用 */
export function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function remainingDaysOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const [y, m, d] = String(dateStr).split('-').map((n) => Number(n))
  if (!y || !m || !d) return null
  const due = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((due.getTime() - today.getTime()) / 86400000)
}

export function formatDate(v: any): string {
  if (isEmptyValue(v)) return EMPTY_DASH
  const s = String(v)
  // 纯数字（数量、时间戳等）原样返回，避免被 dayjs 当毫秒时间戳显示成 1970-01-01
  if (/^-?\d+(\.\d+)?$/.test(s.trim())) return s
  // ISO 带时区（T...Z 或 T...+08:00）：TypeORM 序列化 datetime 为 UTC ISO——转本地时区再取日期（防跨日偏移）
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})/.test(s)) {
    const d = dayjs(v)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  // 日期开头（后面跟空格、T 或直接结束），截取 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s)) return s.slice(0, 10)

  // 避免 "T-100" 之类文本被 dayjs 误解析成 0100-01-01
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s)) {
    const d = dayjs(v)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  return s
}

export function formatDateTime(v: any): string {
  if (isEmptyValue(v)) return EMPTY_DASH
  const s = String(v)
  // 纯数字原样返回，避免被 dayjs 当毫秒时间戳
  if (/^-?\d+(\.\d+)?$/.test(s.trim())) return s
  // ISO 带时区（T...Z 或 T...+08:00）：TypeORM 序列化 datetime 为 UTC ISO——必须转本地时区显示，
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})/.test(s)) {
    const d = dayjs(v)
    if (d.isValid()) return d.format('YYYY-MM-DD HH:mm:ss')
  }
  // 日期时间开头（空格或 T 分隔，无时区 → 视为本地时间原样），截取 YYYY-MM-DD HH:mm 并统一用空格
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace('T', ' ')
  // 仅对明确的日期格式走 dayjs（避免 "T-100" 之类文本被误解析）
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s)) {
    const d = dayjs(v)
    if (d.isValid()) return d.format('YYYY-MM-DD HH:mm')
  }
  return s
}

// 共享 NumberFormat 实例：13 页表格数值列每单元格每次渲染都调用 formatNumber，
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/**
 * 数字千分位格式化：1234567.89 → 1,234,567.89（最多 2 位小数）
 * 空值返回 '-'；非数字原样返回（防脏数据崩溃）
 */
export function formatNumber(v: any): string {
  if (isEmptyValue(v)) return EMPTY_DASH
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return numberFormatter.format(n)
}

export interface NumberColumnOptions {
  /** true=服务端排序（页面须有 handleTableChange→sortBy 接线）；缺省=客户端比较器（全量数据本地排序） */
  sorter?: boolean | ((a: any, b: any) => number)
  /** 自定义显示（默认 formatNumber：千分位 + 空值 '-'） */
  formatter?: (v: any) => string
  resizable?: boolean
  minWidth?: number
}

export function numberColumn(field: string, title: string, width: number, opts: NumberColumnOptions = {}): Record<string, any> {
  const sorter = opts.sorter ?? ((a: any, b: any) => Number(a?.[field] ?? 0) - Number(b?.[field] ?? 0))
  const formatter = opts.formatter ?? formatNumber
  return {
    title,
    dataIndex: field,
    key: field,
    width,
    align: 'right' as const,
    sorter,
    customRender: ({ text }: any) => formatter(text),
    ...(opts.resizable === false ? {} : { resizable: true, minWidth: opts.minWidth ?? 80 }),
  }
}

// 背景：列表表格里字段没值时单元格一片留白，用户无法区分「没填」和「渲染坏了」。
// 规则：没值的字段一律渲染 '-'，补了内容就渲染内容（渲染时实时判定，天然支持后补）。
// ⚠️ 只作用于展示层。数据库与 API 的空值仍是 null/''，绝不在存储层写入 '-'，否则
//    Excel 导出、统计与 AI 取数会读到脏字符串，且 '-' 会被当成「有值」。

/** 空值占位符（全站唯一） */
export const EMPTY_DASH = '-'

/**
 * 空值判定（全站唯一口径）
 *
 * - `null` / `undefined` / `''` / 纯空格串（`'   '`）→ 空
 * - 空数组 → 空
 * - ⚠️ `0` / `'0'` / `false` 是有效业务值（数量、工时、布尔），**不得**判为空
 */
export function isEmptyValue(v: any): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** 空值占位文案：空 → '-'，有值 → 原样转字符串（不参与表格着色，供文本插值使用） */
export function dash(v: any): string {
  return isEmptyValue(v) ? EMPTY_DASH : String(v)
}

/** 空值占位节点：空 → 灰色 '-'（.cell-dash），有值 → 原值（供 customRender / 组件渲染使用） */
export function dashNode(v: any): any {
  return isEmptyValue(v) ? h('span', { class: 'cell-dash' }, EMPTY_DASH) : v
}

export interface EmptyDashOptions {
  /** 排除的列 key：该列需自行渲染（如页面在 #bodyCell 里有专属分支且不希望被兜底） */
  except?: string[]
}

export function withEmptyDash<T extends Record<string, any>>(columns: T[], opts: EmptyDashOptions = {}): T[] {
  const except = new Set(opts.except ?? [])
  return columns.map((col) => {
    if (!col || typeof col !== 'object') return col
    if (Array.isArray(col.children)) return { ...col, children: withEmptyDash(col.children, opts) } as T
    if (col.customRender) return col // 页面已有显式渲染 → 不动
    if (col.type) return col // selection / index / expand
    // 必须有 dataIndex 才注入：无 dataIndex 的列（操作列、序号列，以及完全依赖 #bodyCell
    // 从 record 取值的动态列）本来就没有「默认取值渲染」路径，注入反而会把整条 record
    // 当作取值结果交给 antd
    if (!col.dataIndex) return col
    const key = String(col.key ?? col.dataIndex)
    if (key && except.has(key)) return col
    return {
      ...col,
      customRender: ({ text }: any) => dashNode(text),
    } as T
  })
}
