import { ref } from 'vue'

export interface RecentVisit {
  path: string
  title: string
  at: number
}

/** 首页不记入「最近访问」，否则第一条永远是首页。 */
const STORAGE_KEY = 'starter-recent-visits'
const LIMIT = 6
let accountId: number | undefined
const storageKey = () => accountId === undefined ? undefined : `${STORAGE_KEY}:${accountId}`

function read(): RecentVisit[] {
  try {
    const key = storageKey()
    if (!key) return []
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RecentVisit =>
      !!item && typeof item.path === 'string' && /^\/(?!\/)/.test(item.path) && !/[?#]/.test(item.path)
      && typeof item.title === 'string' && item.title.length <= 100 && Number.isFinite(item.at))
      .slice(0, LIMIT)
  } catch {
    return []
  }
}

/** 模块级共享状态：侧栏记录后，首页无需重新挂载即可读到。 */
export const recentVisits = ref<RecentVisit[]>([])

/** 旧公共 key 没有可靠账号归属，保留原数据但不自动迁入任意账号。 */
export function setRecentVisitsAccount(id?: number) {
  if (accountId === id) return
  accountId = id
  recentVisits.value = read()
}

export function recordVisit(path: string, title: string) {
  const key = storageKey()
  if (!key || !/^\/(?!\/)/.test(path) || /[?#]/.test(path) || path === '/home' || path === '/login' || !title) return
  const next = [{ path, title, at: Date.now() }, ...recentVisits.value.filter((item) => item.path !== path)].slice(0, LIMIT)
  recentVisits.value = next
  try {
    localStorage.setItem(key, JSON.stringify(next))
  } catch {
    /* 隐私模式下 localStorage 不可写，仅在内存中保留 */
  }
}

export function clearRecentVisits() {
  recentVisits.value = []
  try {
    const key = storageKey()
    if (key) localStorage.removeItem(key)
  } catch {
    /* 同上 */
  }
}
