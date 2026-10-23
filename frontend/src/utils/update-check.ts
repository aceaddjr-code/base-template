import { Modal } from 'ant-design-vue'
import type { Router } from 'vue-router'

// F32 前端版本更新提醒：构建期注入 __BUILD_ID__ 并生成 dist/version.json，
// 运行时按间隔比较远端标识，变化时提示用户确认刷新（从不强制刷新、不自动重载）。
// 开发构建（BUILD_ID = 'dev'）不轮询；VITE_UPDATE_CHECK_INTERVAL_MS=0 可整体关闭。

declare const __BUILD_ID__: string | undefined
declare const __UPDATE_CHECK_INTERVAL_MS__: number | undefined

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
export const UPDATE_CHECK_INTERVAL_MS: number =
  typeof __UPDATE_CHECK_INTERVAL_MS__ === 'number' ? __UPDATE_CHECK_INTERVAL_MS__ : 300000

export interface UpdateCheckOptions {
  /** 轮询间隔毫秒；<=0 表示关闭（默认来自构建期 VITE_UPDATE_CHECK_INTERVAL_MS） */
  intervalMs?: number
  /** 当前运行实例的构建标识（默认 BUILD_ID） */
  currentId?: string
  /** 读取远端构建标识；返回 null 表示本次无法判定（网络失败等），静默等下一轮 */
  fetchId?: () => Promise<string | null>
  /** 远端标识变化时回调；同一标识只回调一次，再次变化才会重新回调（“稍后”不被重复打扰） */
  onUpdate?: (id: string) => void
}

export function startUpdateCheck(options: UpdateCheckOptions = {}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS
  const currentId = options.currentId ?? BUILD_ID
  const fetchId = options.fetchId ?? defaultFetchId
  if (!intervalMs || intervalMs <= 0 || currentId === 'dev') return { stop: () => {} }
  let stopped = false
  let lastSeen = currentId
  async function poll() {
    if (stopped) return
    let remote: string | null = null
    try {
      remote = await fetchId()
    } catch {
      remote = null
    }
    if (stopped) return
    if (remote && remote !== lastSeen) {
      lastSeen = remote
      options.onUpdate?.(remote)
    }
  }
  const timer = window.setInterval(() => { void poll() }, intervalMs)
  return {
    stop() {
      stopped = true
      window.clearInterval(timer)
    },
  }
}

async function defaultFetchId(): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { buildId?: unknown } | null
  return typeof data?.buildId === 'string' && data.buildId ? data.buildId : null
}

/** 发布新版本后的确认弹窗：交给用户决定刷新时机，未保存内容由既有保护接管。 */
export function showUpdatePrompt(): void {
  Modal.confirm({
    title: '系统已更新',
    content: '服务端已发布新版本，刷新后生效。如有未保存的修改请先保存；直接刷新时浏览器会再次确认。',
    okText: '立即刷新',
    cancelText: '稍后',
    onOk: () => { window.location.reload() },
  })
}

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return CHUNK_ERROR_PATTERN.test(message)
}

// 每次会话只提示一次：资源失效说明已有新版本部署，刷新提示重复出现只会造成打扰。
let chunkReloadPrompted = false
export function promptChunkReloadOnce(): void {
  if (chunkReloadPrompted) return
  chunkReloadPrompted = true
  Modal.confirm({
    title: '页面资源已失效',
    content: '系统已更新，当前页面加载的资源不再存在。请刷新后继续使用。',
    okText: '立即刷新',
    cancelText: '稍后',
    onOk: () => { window.location.reload() },
  })
}

/** 路由懒加载与异步组件的动态导入失败统一接到同一个一次性刷新提示。 */
export function installUpdateReloadPrompt(router: Router): void {
  router.onError((error) => {
    if (isChunkLoadError(error)) promptChunkReloadOnce()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) promptChunkReloadOnce()
  })
}
