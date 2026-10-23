
const REPORT_URL = '/api/v1/monitor/frontend-error'
const BATCH: any[] = []
let timer: number | null = null
const MAX_BATCH = 20
const MAX_BYTES = 48 * 1024
let enabled = true
const reported = new WeakSet<object>()

function safeUrl(value: string | undefined) {
  if (!value) return undefined
  try { const url = new URL(value, location.origin); return `${url.origin}${url.pathname}`.slice(0, 1000) }
  catch { return '[invalid-url]' }
}

export function disableErrorReport() { enabled = false }
export function enableErrorReport() { enabled = true }

function base() {
  return { page: safeUrl(location.href), ua: navigator.userAgent.slice(0, 1000), ts: new Date().toISOString() }
}

function push(payload: any) {
  if (!enabled) return
  if (typeof payload.message === 'string') payload.message = payload.message.slice(0, 1000)
  if (typeof payload.stack === 'string') payload.stack = payload.stack.slice(0, 5000)
  if (typeof payload.file === 'string') payload.file = safeUrl(payload.file)
  BATCH.push(payload)
  if (BATCH.length >= MAX_BATCH) flush()
  else if (!timer) timer = window.setTimeout(flush, 3000)
}

function flush() {
  if (!BATCH.length) return
  if (timer) { clearTimeout(timer); timer = null }
  const batch: any[] = []
  while (BATCH.length && batch.length < MAX_BATCH) {
    const candidate = BATCH[0]
    if (new Blob([JSON.stringify({ events: [...batch, candidate] })]).size > MAX_BYTES) {
      if (!batch.length) BATCH.shift() // 防止异常超大单项永久堵塞队列
      break
    }
    batch.push(BATCH.shift())
  }
  if (BATCH.length) timer = window.setTimeout(flush, 1000)
  if (!batch.length) return
  const body = JSON.stringify({ events: batch })
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(REPORT_URL, new Blob([body], { type: 'application/json' }))
      if (!ok) fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } else {
      fetch(REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* 上报失败静默 */ }
}

// 1. JS 运行时错误
window.addEventListener('error', (e) => {
  push({ type: 'js-error', message: e.message || String(e.error || ''), stack: e.error?.stack, file: e.filename, line: e.lineno, col: e.colno, ...base() })
})

// 2. Promise 未处理
window.addEventListener('unhandledrejection', (e) => {
  const reason: any = e.reason
  if (reason && typeof reason === 'object' && (reported.has(reason) || reason.code === 'ERR_CANCELED')) return
  push({ type: 'unhandledrejection', message: reason?.message || String(reason || ''), stack: reason?.stack, ...base() })
})

// 3. console.error 拦截（保留原始输出）
const origConsoleError = console.error
console.error = (...args: any[]) => {
  origConsoleError.apply(console, args)
  try {
    const errObj = args.find((a) => a instanceof Error)
    push({
      type: 'console-error',
      message: args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
      stack: errObj?.stack,
      ...base(),
    })
  } catch { /* ignore */ }
}

// 4. 接口请求失败（在 axios 拦截器调用）
export function reportRequestError(err: any) {
  if (!enabled) return
  if (err?.code === 'ERR_CANCELED' || (err && typeof err === 'object' && reported.has(err))) return
  if (err && typeof err === 'object') reported.add(err)
  const resp = err?.response
  const requestId = err?.requestId || resp?.data?.requestId || resp?.headers?.['x-request-id']
  push({
    type: 'network-error',
    message: err?.message || '请求失败',
    status: resp?.status ?? null,
    method: err?.config?.method,
    url: safeUrl(err?.config?.url),
    requestId: typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(requestId) ? requestId : undefined,
    ...base(),
  })
}

// 页面卸载前发掉积压
window.addEventListener('pagehide', () => flush())
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
