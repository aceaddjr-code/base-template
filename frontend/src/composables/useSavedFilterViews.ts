import { ref, watch } from 'vue'
import { accountStorageKey } from './accountStorageKey'

/**
 * 个人常用筛选视图（F27）：本机按账号保存（当前浏览器），不做团队共享与后端同步。
 * 视图保存"条件 + 排序"；应用时由调用方负责相对日期重算与字段失效提示。
 */
export interface SavedFilterView {
  id: string
  name: string
  query: Record<string, unknown>
  sort: Record<string, unknown>
  savedAt: string
}

interface ViewsEnvelope {
  version: number
  views: SavedFilterView[]
  defaultId?: string
}

const ENVELOPE_VERSION = 1

function readEnvelope(storageKey: string): ViewsEnvelope {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { version: ENVELOPE_VERSION, views: [] }
    const parsed = JSON.parse(raw) as ViewsEnvelope
    if (parsed?.version === ENVELOPE_VERSION && Array.isArray(parsed.views)) {
      return { version: ENVELOPE_VERSION, views: parsed.views.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string'), defaultId: parsed.defaultId }
    }
  } catch { /* 存储不可用或损坏时按空开始 */ }
  return { version: ENVELOPE_VERSION, views: [] }
}

export function useSavedFilterViews(options: {
  moduleKey: string
  /** 当前模块可用的筛选字段；应用视图时忽略未知字段并回传，供界面提示失效 */
  knownFields: () => string[]
}) {
  const storageKey = accountStorageKey(`starter-filter-views:${options.moduleKey}`)
  const envelope = ref<ViewsEnvelope>(readEnvelope(storageKey))
  const views = ref<SavedFilterView[]>(envelope.value.views)
  const defaultId = ref<string | undefined>(envelope.value.defaultId)

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: ENVELOPE_VERSION, views: views.value, defaultId: defaultId.value })) } catch { /* 存储失败不影响本次交互 */ }
  }

  function save(name: string, query: Record<string, unknown>, sort: Record<string, unknown>): SavedFilterView {
    const trimmed = name.trim()
    const existing = views.value.find((view) => view.name === trimmed)
    if (existing) {
      existing.query = query
      existing.sort = sort
      existing.savedAt = new Date().toISOString()
      persist()
      return existing
    }
    const view: SavedFilterView = { id: `v${Date.now()}${Math.floor(Math.random() * 1000)}`, name: trimmed, query, sort, savedAt: new Date().toISOString() }
    views.value = [...views.value, view]
    if (views.value.length === 1) defaultId.value = view.id
    persist()
    return view
  }

  function rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    views.value = views.value.map((view) => (view.id === id ? { ...view, name: trimmed } : view))
    persist()
  }

  function remove(id: string): void {
    views.value = views.value.filter((view) => view.id !== id)
    if (defaultId.value === id) defaultId.value = undefined
    persist()
  }

  function setDefault(id: string | undefined): void {
    defaultId.value = defaultId.value === id ? undefined : id
    persist()
  }

  /** 应用视图：丢弃未知字段（字段结构已变化）并回传被忽略的字段名；查询按引用副本返回 */
  function loadView(id: string): { query: Record<string, unknown>; sort: Record<string, unknown>; staleKeys: string[] } | undefined {
    const view = views.value.find((item) => item.id === id)
    if (!view) return undefined
    const known = new Set(options.knownFields())
    const query: Record<string, unknown> = {}
    const staleKeys: string[] = []
    for (const [key, value] of Object.entries(view.query)) {
      if (known.has(key)) query[key] = value
      else staleKeys.push(key)
    }
    return { query, sort: { ...view.sort }, staleKeys }
  }

  // 账号变化必经登录页整页跳转，这里仅防御性同步（与 useColumnConfig 的进入时确定一致）。
  watch(() => storageKey, () => {
    envelope.value = readEnvelope(storageKey)
    views.value = envelope.value.views
    defaultId.value = envelope.value.defaultId
  })

  return { views, defaultId, save, rename, remove, setDefault, loadView }
}
