import { computed, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { FieldConfig } from '@/types/common'
import { accountStorageKey } from './accountStorageKey'

type ColumnDefinition = Record<string, any>
const columnKey = (column: ColumnDefinition) => String(column.key ?? column.dataIndex ?? '')

function defaultsFor(columns: ColumnDefinition[]): FieldConfig[] {
  return columns.filter(column => columnKey(column)).map(column => ({
    key: columnKey(column), label: column.title ?? column.key ?? '', type: 'text',
    visible: column.hidden !== true, sortable: true, filterable: false, fixed: column.fixed,
  }))
}

/** 只恢复偏好，列定义、标签和固定位置始终以当前列全集为准。 */
function mergeFields(defaults: FieldConfig[], saved: unknown, lockedKeys: readonly string[]): FieldConfig[] {
  const available = new Map(defaults.map(field => [field.key, field]))
  const result: FieldConfig[] = []
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (!item || typeof item.key !== 'string') continue
      const field = available.get(item.key)
      if (!field) continue
      result.push({ ...field, visible: typeof item.visible === 'boolean' ? item.visible : field.visible })
      available.delete(item.key)
    }
  }
  result.push(...available.values())
  const locked = new Set(lockedKeys)
  return [
    ...result.filter(field => !locked.has(field.key)),
    ...result.filter(field => locked.has(field.key)).map(field => ({ ...field, visible: true })),
  ]
}

function readFields(storageKey: string): unknown {
  if (!storageKey) return undefined
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const saved: unknown = JSON.parse(raw)
    if (Array.isArray(saved)) return saved
    // 兼容历史列宽格式；已有独立列宽优先，禁止覆盖用户后续拖拽结果。
    if (saved && typeof saved === 'object') {
      if (!localStorage.getItem(`${storageKey}-width`)) localStorage.setItem(`${storageKey}-width`, raw)
      localStorage.removeItem(storageKey)
    }
  } catch { /* 存储不可用或损坏时使用默认偏好 */ }
  return undefined
}

function selectColumns<T extends ColumnDefinition>(columns: T[], fields: FieldConfig[]): T[] {
  const available = new Map(columns.map(column => [columnKey(column), column]))
  return fields.filter(field => field.visible && available.has(field.key)).map(field => available.get(field.key)!)
}

/**
 * 列全集是稳定来源，可见列只作为输出。偏好恢复、合并、显隐和锁尾共享一个 implementation。
 * 返回原列对象以保留 customRender、响应式列宽及 useResizableColumns 的引用。
 */
export function useColumnConfig<T extends ColumnDefinition>(
  storageKey: string,
  columns: MaybeRefOrGetter<T[]>,
  lockedKeys: MaybeRefOrGetter<readonly string[]> = ['action'],
) {
  // 列偏好按账号隔离：本页组件仅在会话就绪后挂载，进入时账号已确定。
  const scopedKey = accountStorageKey(storageKey)
  const fields = shallowRef<FieldConfig[]>([])
  const defaults = computed(() => defaultsFor(toValue(columns)))
  const locked = computed(() => toValue(lockedKeys))
  // 模板内联 ['actions'] 会随父级每次重绘产生新数组，只在 key 集合变化时合并。
  // 否则 visibleColumns 回写父级后又重设 fields，形成反馈循环。
  const lockedToken = computed(() => JSON.stringify([...new Set(locked.value)].sort()))
  let restored = false
  watch([defaults, lockedToken], () => {
    fields.value = mergeFields(defaults.value, restored ? fields.value : readFields(scopedKey), locked.value)
    restored = true
  }, { immediate: true })

  const isLocked = (key: string) => locked.value.includes(key)
  const visibleColumns = computed(() => selectColumns(toValue(columns), fields.value))
  const checkable = computed(() => fields.value.filter(field => !isLocked(field.key)))
  const allChecked = computed(() => checkable.value.length > 0 && checkable.value.every(field => field.visible))
  const indeterminate = computed(() => checkable.value.some(field => field.visible) && !allChecked.value)

  function saveFields(): void {
    if (!scopedKey) return
    try { localStorage.setItem(scopedKey, JSON.stringify(fields.value)) } catch { /* 存储失败不影响本次交互 */ }
  }
  function toggleField(key: string): void {
    if (isLocked(key)) return
    fields.value = fields.value.map(field => field.key === key ? { ...field, visible: !field.visible } : field)
    saveFields()
  }
  function toggleAll(visible: boolean): void {
    fields.value = fields.value.map(field => ({ ...field, visible: isLocked(field.key) || visible }))
    saveFields()
  }
  function resetFields(): void {
    fields.value = mergeFields(defaults.value, undefined, locked.value)
    saveFields()
  }
  function moveFieldTo(fromIndex: number, toIndex: number): void {
    const source = fields.value[fromIndex]
    const target = fields.value[toIndex]
    if (!source || !target || isLocked(source.key) || isLocked(target.key) || fromIndex === toIndex) return
    const next = [...fields.value]
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, source)
    fields.value = next
    saveFields()
  }
  return { fields, visibleColumns, isLocked, allChecked, indeterminate, toggleField, toggleAll, resetFields, moveFieldTo }
}

export type ColumnPreferences = ReturnType<typeof useColumnConfig>

/** 兼容静态调用；与交互 adapter 使用相同的恢复和结果规则。 */
export function applyColumnConfig<T extends ColumnDefinition>(
  columns: T[], storageKey: string, lockedKeys: string[] = ['action'],
): T[] {
  return selectColumns(columns, mergeFields(defaultsFor(columns), readFields(accountStorageKey(storageKey)), lockedKeys))
}
