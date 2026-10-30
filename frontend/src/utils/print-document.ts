/**
 * F21 单据打印/保存 PDF：从已加载的详情数据生成 A4 打印文档。
 * 打印范围始终是「当前查看的这一条记录」——抽屉里的数据即完整服务端详情；
 * 不把列表页 DOM 当作数据来源。输出为独立 HTML（内联打印样式），由调用方
 * 通过隐藏 iframe 呈现并调用浏览器打印（可另存 PDF）。
 */
import { formatDate } from './format'

export interface PrintFieldRow {
  label: string
  value: string
  /** 分组标题（与详情抽屉的字段分组一致） */
  group?: string
}

export interface PrintFieldLike {
  label: string
  dataIndex: string
  valueType?: 'text' | 'tag' | 'boolean'
  formatter?: (record: Record<string, any>) => string
  hidden?: (record: Record<string, any> | null | undefined) => boolean
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 与详情抽屉的查看态展示口径一致：boolean→是/否、formatter 优先、缺省走日期格式化、空值 '-' */
export function resolveFieldValue(field: PrintFieldLike, record: Record<string, any>): string {
  const raw = record?.[field.dataIndex]
  if (field.valueType === 'boolean') return raw == null ? '-' : (raw ? '是' : '否')
  if (field.formatter) {
    const text = field.formatter(record)
    return text == null || text === '' ? '-' : String(text)
  }
  if (field.valueType === 'tag') return raw == null || raw === '' ? '-' : String(raw)
  if (raw == null || raw === '') return '-'
  const formatted = formatDate(raw)
  return formatted == null || formatted === '' ? '-' : String(formatted)
}

/** 从字段定义收集打印行（跳过 hidden），并在末尾补创建/修改时间（与抽屉口径一致） */
export function collectPrintRows(
  fields: PrintFieldLike[],
  record: Record<string, any> | null | undefined,
  options: { showAuditTime?: boolean } = {},
): PrintFieldRow[] {
  if (!record) return []
  const rows: PrintFieldRow[] = []
  for (const field of fields) {
    if (field.hidden?.(record)) continue
    rows.push({ label: field.label, value: resolveFieldValue(field, record) })
  }
  if (options.showAuditTime !== false) {
    if (record.createdAt && !fields.some((f) => f.dataIndex === 'createdAt')) rows.push({ label: '创建时间', value: formatDate(record.createdAt) || '-' })
    if (record.updatedAt && !fields.some((f) => f.dataIndex === 'updatedAt')) rows.push({ label: '修改时间', value: formatDate(record.updatedAt) || '-' })
  }
  return rows
}

export interface PrintDocumentOptions {
  /** 单据标题（抽屉标题，如「示例事项详情」） */
  title: string
  /** 系统名称（打印抬头） */
  systemName?: string
  /** 记录标识（打印编号行；缺省不显示） */
  recordId?: number | string | null
  rows: PrintFieldRow[]
  printedAt: Date
  /** 范围声明（固定文案由调用方传入，模板不猜数据边界） */
  scopeNote: string
}

/** 生成独立 A4 打印文档（转义所有动态值，不输出任何脚本） */
export function buildPrintDocument(options: PrintDocumentOptions): string {
  const { title, systemName, recordId, rows, printedAt, scopeNote } = options
  const pad = (n: number) => String(n).padStart(2, '0')
  const printedAtText = `${printedAt.getFullYear()}-${pad(printedAt.getMonth() + 1)}-${pad(printedAt.getDate())} ${pad(printedAt.getHours())}:${pad(printedAt.getMinutes())}`
  const bodyRows = rows
    .map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`)
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1f1c1c; font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; font-size: 12pt; line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-head { border-bottom: 2px solid #1f1c1c; padding-bottom: 8px; margin-bottom: 14px; }
  .doc-system { font-size: 10pt; color: #555; }
  .doc-title { font-size: 16pt; font-weight: 700; margin: 2px 0; }
  .doc-meta { font-size: 10pt; color: #555; }
  table.doc-fields { width: 100%; border-collapse: collapse; }
  table.doc-fields th, table.doc-fields td { border-bottom: 1px solid #d8d5d5; padding: 7px 8px; text-align: left; vertical-align: top; }
  table.doc-fields th { width: 22%; font-weight: 400; color: #555; background: #f6f5f5; white-space: nowrap; }
  table.doc-fields td { white-space: pre-wrap; overflow-wrap: anywhere; }
  .doc-foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d8d5d5; font-size: 10pt; color: #555; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
</style>
</head>
<body>
<header class="doc-head">
  <div class="doc-system">${escapeHtml(systemName || '')}</div>
  <div class="doc-title">${escapeHtml(title)}</div>
  <div class="doc-meta">${recordId != null ? `编号：${escapeHtml(String(recordId))}　` : ''}打印时间：${printedAtText}</div>
</header>
<table class="doc-fields">
${bodyRows}
</table>
<footer class="doc-foot"><span>${escapeHtml(scopeNote)}</span><span>数据以系统内实时内容为准</span></footer>
</body>
</html>`
}

/** 用隐藏 iframe 呈现打印文档并调起浏览器打印（用户可在打印对话框选择另存 PDF） */
let activeFrame: HTMLIFrameElement | null = null
export function printHtml(html: string): void {
  // 上一份打印残留（afterprint 未触发的环境）由本次替换清理
  activeFrame?.remove()
  const frame = document.createElement('iframe')
  activeFrame = frame
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  if (!win) { frame.remove(); activeFrame = null; throw new Error('浏览器未能准备打印文档，请重试') }
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()
  win.addEventListener('afterprint', () => { frame.remove(); if (activeFrame === frame) activeFrame = null }, { once: true })
  win.focus()
  win.print()
}
