import { ref, onUnmounted, type Ref } from 'vue'
import { accountStorageKey } from './accountStorageKey'

export function useResizableColumns(
  storageKey: string,
  columns: Ref<any[]>,
  defaults: Record<string, number> = {},
  /**
   * 弹性列：保持「无固定宽度」，用来吸收表格的剩余宽度。
   *
   * 必须始终留至少一列不给宽度。`table-layout: fixed` 下若所有列都有固定宽度，
   * 浏览器会把表格宽于列宽之和的部分**按比例**摊给每一列——勾选框、状态这类窄列
   * 会被一起放大（实测 32px 的勾选列能被放到 56px，宽屏更多），而且改不回来。
   */
  flexKeys: string[] = [],
) {
  // 列宽与显隐/排序同一账号隔离策略；列表页仅在会话就绪后挂载。
  const scopedKey = accountStorageKey(storageKey)
  /** 列宽（默认值 + localStorage 恢复；拖拽期间只改内存，onColUp 落盘） */
  const colWidths: Record<string, number> = { ...defaults }
  try {
    const saved = localStorage.getItem(scopedKey)
    if (saved) Object.assign(colWidths, JSON.parse(saved))
  } catch { /* 存储损坏忽略 */ }
  // 旧数据里可能存过弹性列的宽度，一律丢弃，否则表格会重新进入等比放大。
  for (const key of flexKeys) delete colWidths[key]
  // 同步到列对象（columns 定义已用 defaults 初始化，这里用恢复值覆盖）
  for (const col of columns.value as any[]) {
    if (flexKeys.includes(String(col.key))) { delete col.width; continue }
    if (colWidths[col.key] != null) col.width = colWidths[col.key]
  }
  const isFlexible = (key: string | number) => flexKeys.includes(String(key))

  const resizingCol = ref<string | null>(null)
  let resizeStartX = 0
  let resizeStartW = 0
  let previousUserSelect = ''
  let releaseClickTimer: ReturnType<typeof setTimeout> | undefined

  function clearResizeClick() {
    clearTimeout(releaseClickTimer)
    document.removeEventListener('click', stopResizeClick, true)
  }

  function stopResizeClick(e: MouseEvent) {
    e.preventDefault()
    e.stopImmediatePropagation()
    clearResizeClick()
  }

  function onColMove(e: MouseEvent) {
    if (!resizingCol.value) return
    colWidths[resizingCol.value] = Math.max(60, resizeStartW + (e.clientX - resizeStartX))
    const col = columns.value.find((c: any) => c.key === resizingCol.value)
    if (col) (col as any).width = colWidths[resizingCol.value]
  }

  function onColUp() {
    resizingCol.value = null
    document.removeEventListener('mousemove', onColMove)
    document.removeEventListener('mouseup', onColUp)
    document.body.style.userSelect = previousUserSelect
    // mouseup 之后的 click 可能落在表头父容器，不能让这次拖动触发排序。
    releaseClickTimer = setTimeout(clearResizeClick, 0)
    try {
      localStorage.setItem(scopedKey, JSON.stringify(colWidths))
    } catch { /* 存储失败不影响拖拽 */ }
  }

  function resizeStart(key: string | number, e: MouseEvent) {
    const k = String(key)
    if (isFlexible(k)) return
    clearResizeClick()
    document.addEventListener('click', stopResizeClick, true)
    resizingCol.value = k
    resizeStartX = e.clientX
    // 起点 = 已存列宽或默认 150（首次拖拽不塌陷）
    resizeStartW = colWidths[k] || 150
    previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onColMove)
    document.addEventListener('mouseup', onColUp)
  }

  /** 非拖拽入口（F35）：列设置面板按数值直接改宽，与拖拽同一落盘规则 */
  function setColumnWidth(key: string | number, width: number): void {
    const k = String(key)
    if (isFlexible(k)) return
    if (!Number.isFinite(width) || width < 60 || width > 1000) return
    colWidths[k] = width
    const col = (columns.value as any[]).find((c) => c.key === k)
    if (col) col.width = width
    try {
      localStorage.setItem(scopedKey, JSON.stringify(colWidths))
    } catch { /* 存储失败不影响本次输入 */ }
  }

  onUnmounted(() => {
    clearResizeClick()
    if (resizingCol.value) document.body.style.userSelect = previousUserSelect
    document.removeEventListener('mousemove', onColMove)
    document.removeEventListener('mouseup', onColUp)
  })

  return { colWidths, resizeStart, setColumnWidth, isFlexible }
}
