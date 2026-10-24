import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

type Sort = { sortBy?: string; sortOrder?: 'ASC' | 'DESC' }
type Saved = { applied: object; page: number; pageSize: number; sort: Sort; top: number; left: number }
const saved = new Map<string, Saved>()
export function clearListQueryState() { saved.clear() }
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

/** 列表与导出共享已应用快照；仅当前登录期间保留返回状态，不写 URL 或本地存储。 */
export function useListQuery<Q extends object, Row>(options: {
  key: string
  defaults: () => Q
  account: () => number | undefined
  normalize: (query: Q) => Q
  load: (query: Q & Sort & { page: number; pageSize: number }, signal: AbortSignal) => Promise<{ list: Row[]; total: number }>
  pageSize?: number
  scrollElement?: () => HTMLElement | null | undefined
  onQueryChanged?: () => void
}) {
  const account = options.account
  const storageKey = () => `${account()}:${options.key}`
  const initial = account() ? saved.get(storageKey()) : undefined
  const applied = ref<Q>(copy(initial?.applied ?? options.defaults()) as Q) as Ref<Q>
  const draft = ref<Q>(copy(applied.value)) as Ref<Q>
  const page = ref(initial?.page ?? 1), pageSize = ref(initial?.pageSize ?? options.pageSize ?? 10)
  const sort = ref<Sort>(copy(initial?.sort ?? {}))
  const rows = ref<Row[]>([]) as Ref<Row[]>
  const total = ref(0), loading = ref(false), failed = ref(false)
  const dirty = computed(() => JSON.stringify(options.normalize(draft.value)) !== JSON.stringify(applied.value))
  const activeQuery = computed(() => ({ ...copy(applied.value), ...sort.value }))
  let version = 0, controller: AbortController | undefined
  let pendingScroll = initial ? { top: initial.top, left: initial.left } : undefined
  let disposed = false
  function persist() {
    if (!account()) return
    const element = options.scrollElement?.()
    saved.set(storageKey(), { applied: copy(applied.value), page: page.value, pageSize: pageSize.value, sort: copy(sort.value), top: pendingScroll?.top ?? element?.scrollTop ?? 0, left: pendingScroll?.left ?? element?.scrollLeft ?? 0 })
  }
  async function refresh(): Promise<void> {
    const element = options.scrollElement?.()
    pendingScroll ??= { top: element?.scrollTop ?? 0, left: element?.scrollLeft ?? 0 }
    options.onQueryChanged?.()
    const current = ++version
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const requestAccount = account()
    loading.value = true
    failed.value = false
    // 失败或查询中不把上一条件的记录和数量当成当前结果。
    rows.value = []
    total.value = 0
    try {
      const result = await options.load({ ...activeQuery.value, page: page.value, pageSize: pageSize.value }, signal)
      if (disposed || current !== version || signal.aborted || requestAccount !== account()) return
      const last = Math.max(1, Math.ceil(result.total / pageSize.value))
      if (page.value > last) { page.value = last; return refresh() }
      rows.value = result.list
      total.value = result.total
      await nextTick()
      if (current !== version || disposed) return
      const element = options.scrollElement?.()
      if (element) {
        element.scrollTop = pendingScroll?.top ?? 0
        element.scrollLeft = pendingScroll?.left ?? element.scrollLeft
      }
      pendingScroll = undefined
      persist()
    } catch (error) {
      if (current === version && !disposed && !signal.aborted && requestAccount === account()) failed.value = true
    } finally { if (current === version && !disposed) loading.value = false }
  }
  function apply(query = draft.value) {
    applied.value = copy(options.normalize(query))
    draft.value = copy(applied.value)
    page.value = 1
    pendingScroll = { top: 0, left: options.scrollElement?.()?.scrollLeft ?? 0 }
    return refresh()
  }
  function reset() { sort.value = {}; return apply(options.defaults()) }
  function changePage(current: number, size = pageSize.value) {
    if (page.value === current && pageSize.value === size) return Promise.resolve()
    page.value = size !== pageSize.value ? 1 : current
    pageSize.value = size
    pendingScroll = { top: 0, left: options.scrollElement?.()?.scrollLeft ?? 0 }
    return refresh()
  }
  function changeSort(value: Sort) {
    sort.value = copy(value)
    page.value = 1
    pendingScroll = { top: 0, left: options.scrollElement?.()?.scrollLeft ?? 0 }
    return refresh()
  }
  watch(account, () => {
    ++version
    controller?.abort()
    pendingScroll = undefined
    rows.value = []; total.value = 0; failed.value = false; loading.value = false
    draft.value = options.defaults(); applied.value = options.defaults(); sort.value = {}; page.value = 1
  }, { flush: 'sync' })
  onMounted(() => { void refresh() })
  onBeforeUnmount(() => { persist(); disposed = true; ++version; controller?.abort() })

  /** 关键词回车查询：输入法组合确认（isComposing / 229）不触发 */
  function onSearchEnter(event: KeyboardEvent) { if (!event.isComposing && event.keyCode !== 229) void apply() }

  /** 页脚总数三态文案：失败暂不可用 / 查询中 / 正常计数 */
  const totalText = computed(() => (count: number) => (failed.value ? '数量暂不可用' : loading.value ? '查询中…' : `共 ${count} 条`))

  return { draft, applied, dirty, activeQuery, rows, total, loading, failed, page, pageSize, sort, refresh, apply, reset, changePage, changeSort, onSearchEnter, totalText }
}
