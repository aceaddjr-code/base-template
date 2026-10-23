/** 错误/失败明细的通用 CSV 下载：带 BOM（Excel 按 UTF-8 识别中文），含逗号/引号/换行的单元格按 CSV 规则引号转义。 */
export function downloadCsv(filename: string, columns: string[], rows: Array<Array<string | number>>): void {
  const quote = (cell: string | number) => {
    const value = String(cell)
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }
  const csv = '\uFEFF' + [columns, ...rows].map((cells) => cells.map(quote).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}
