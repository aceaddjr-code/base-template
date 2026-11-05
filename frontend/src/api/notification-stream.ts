import { API_BASE } from './request'
import { NOTIFICATIONS_CHANGED } from './notifications'

/**
 * 通知 SSE 客户端：
 * - EventSource 同源携带 Cookie（不发 URL Token）；
 * - 收到 notifications-changed 只派发刷新事件——未读数不本地 +1，一律拉接口；
 * - session-expired 停止连接且不自动重连（HTTP 401 已有整页跳转）；
 * - 断线指数退避＋抖动（上限 30s）；SSE 不可用降级为可见页 30s 轮询＋切回立即拉。
 */
export interface NotificationStreamHandle {
  close: () => void
}

export function connectNotificationStream(options: {
  onChanged: () => void
  onSessionExpired?: () => void
  pollFallbackMs?: number
}): NotificationStreamHandle {
  let source: EventSource | null = null
  let retry = 0
  let closed = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let visibilityHandler: (() => void) | undefined

  const scheduleRetry = () => {
    if (closed) return
    const base = Math.min(30000, 1000 * 2 ** retry)
    const delay = base * (0.5 + Math.random() / 2) // 抖动：0.5×—1×
    retry += 1
    retryTimer = setTimeout(connect, delay)
  }

  const startPollFallback = () => {
    if (pollTimer || closed) return
    const interval = options.pollFallbackMs ?? 30000
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') options.onChanged()
    }, interval)
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') options.onChanged()
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  const connect = () => {
    if (closed) return
    source = new EventSource(`${API_BASE}/system/notifications/stream`, { withCredentials: true })
    source.addEventListener('open', () => { retry = 0; if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined } })
    source.addEventListener('notifications-changed', () => options.onChanged())
    source.addEventListener('session-expired', () => {
      options.onSessionExpired?.()
      close()
    })
    source.onerror = () => {
      // 浏览器对 EventSource 自带重连；连接彻底失败（readyState CLOSED）才自管退避＋降级
      if (source?.readyState === EventSource.CLOSED) {
        source.close()
        source = null
        scheduleRetry()
        startPollFallback()
      }
    }
  }

  const close = () => {
    closed = true
    source?.close()
    source = null
    if (retryTimer) clearTimeout(retryTimer)
    if (pollTimer) clearInterval(pollTimer)
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler)
    window.removeEventListener(NOTIFICATIONS_CHANGED, onLocalChange)
  }
  // 同页其他动作（markRead/read-all）仍走本地事件；多标签一致性由 SSE 变化检测覆盖
  const onLocalChange = () => options.onChanged()
  window.addEventListener(NOTIFICATIONS_CHANGED, onLocalChange)

  connect()
  return { close }
}
