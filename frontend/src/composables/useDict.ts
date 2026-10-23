import { computed, getCurrentScope, onScopeDispose, readonly } from 'vue'
import { dictAllEntry, dictEntry, loadDict, loadDictAll } from '@/utils/dict-cache'

export interface DictOption {
  label: string
  value: string
  color: string | null
}

export function useDict(typeCode: string) {
  const entry = dictEntry(typeCode)
  const options = computed<DictOption[]>(() => entry.data.value?.options ?? [])
  const dictName = computed(() => entry.data.value?.name ?? '')
  if (getCurrentScope()) {
    entry.subscribers++
    onScopeDispose(() => { entry.subscribers-- })
  }
  const refresh = () => loadDict(typeCode, true)

  /** 值 → 显示文字（查不到回退原值，存量脏数据也能显示） */
  function labelOf(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '-'
    return options.value.find((o) => o.value === value)?.label ?? String(value)
  }

  /** 值 → 标签颜色（antd 预设名，供 a-tag 用） */
  function colorOf(value: string | null | undefined): string | undefined {
    if (!value) return undefined
    return options.value.find((o) => o.value === value)?.color ?? undefined
  }

  void loadDict(typeCode).catch(() => { /* error ref 与请求层呈现错误 */ })

  // ===== 历史值回显（F40）：全量选项（含停用）单独缓存,仅用于已存储值的标签解析 =====
  const allEntry = dictAllEntry(typeCode)
  if (getCurrentScope()) {
    allEntry.subscribers++
    onScopeDispose(() => { allEntry.subscribers-- })
  }
  void loadDictAll(typeCode).catch(() => { /* 回显失败退回原值展示 */ })

  /** 存量值 → 显示文字:启用项显示名称;停用项显示"名称（已停用）";未知回退原值 */
  function labelOfAny(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '-'
    const enabled = options.value.find((o) => o.value === value)
    if (enabled) return enabled.label
    const anyMatch = (allEntry.data.value?.options ?? []).find((o) => o.value === value)
    return anyMatch ? `${anyMatch.label}（已停用）` : String(value)
  }

  return { loading: readonly(entry.loading), error: readonly(entry.error), options, dictName, labelOf, colorOf, labelOfAny, refresh }
}
