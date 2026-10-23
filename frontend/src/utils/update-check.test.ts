import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal } from 'ant-design-vue'
import type { Router } from 'vue-router'
import { installUpdateReloadPrompt, isChunkLoadError, showUpdatePrompt, startUpdateCheck } from './update-check'

vi.mock('ant-design-vue', () => ({ Modal: { confirm: vi.fn(() => ({ destroy: vi.fn() })) } }))
const confirmMock = vi.mocked(Modal.confirm)

beforeEach(() => {
  vi.useFakeTimers()
  confirmMock.mockClear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('F32 版本更新检查', () => {
  it('版本一致不提示；变化后同一标识只回调一次，“稍后”后再有新版本才重新回调；stop 后不再轮询', async () => {
    let remote = 'A'
    const onUpdate = vi.fn()
    const check = startUpdateCheck({ intervalMs: 1000, currentId: 'A', fetchId: async () => remote, onUpdate })
    await vi.advanceTimersByTimeAsync(3000)
    expect(onUpdate).not.toHaveBeenCalled()
    remote = 'B'
    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith('B')
    await vi.advanceTimersByTimeAsync(2000)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    remote = 'C'
    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenLastCalledWith('C')
    check.stop()
    remote = 'D'
    await vi.advanceTimersByTimeAsync(5000)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it('读取失败静默等下一轮，不视为版本变化', async () => {
    let calls = 0
    const onUpdate = vi.fn()
    startUpdateCheck({
      intervalMs: 1000,
      currentId: 'A',
      fetchId: async () => { calls += 1; if (calls === 1) throw new Error('network down'); return 'B' },
      onUpdate,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledWith('B')
  })

  it('interval 关闭或开发构建不启动轮询', async () => {
    const fetchId = vi.fn(async () => 'B')
    startUpdateCheck({ intervalMs: 0, currentId: 'A', fetchId, onUpdate: vi.fn() })
    startUpdateCheck({ intervalMs: 1000, currentId: 'dev', fetchId, onUpdate: vi.fn() })
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchId).not.toHaveBeenCalled()
  })

  it('更新提示弹窗交给用户确认，文案包含未保存提醒且不自动刷新', () => {
    showUpdatePrompt()
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const options = confirmMock.mock.calls[0]![0]
    expect(options.title).toBe('系统已更新')
    expect(String(options.content)).toContain('未保存')
  })
})

describe('F32 资源加载失败反馈', () => {
  it('识别已知动态导入失败文案，不误报普通错误', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/index-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('TypeError: Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError(new Error('timeout of 10000ms exceeded'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('路由错误与未处理拒绝接入同一提示，整个会话只提示一次', () => {
    const onErrorHandlers: Array<(error: unknown) => unknown> = []
    const router = { onError: vi.fn((handler: (error: unknown) => unknown) => { onErrorHandlers.push(handler) }) } as unknown as Router
    installUpdateReloadPrompt(router)
    const handler = onErrorHandlers[0]!
    handler(new Error('Failed to fetch dynamically imported module: /assets/home-1.js'))
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const options = confirmMock.mock.calls[0]![0]
    expect(options.title).toBe('页面资源已失效')
    handler(new Error('Failed to fetch dynamically imported module: /assets/home-1.js'))
    handler(new Error('boom'))
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('Importing a module script failed.') })
    window.dispatchEvent(event)
    expect(confirmMock).toHaveBeenCalledTimes(1)
  })
})
