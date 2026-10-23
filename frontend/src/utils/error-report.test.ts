import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disableErrorReport, enableErrorReport, reportRequestError } from './error-report'

const sendBeacon = vi.fn((_url: string, _body: Blob) => true)
beforeEach(() => {
  vi.useFakeTimers()
  sendBeacon.mockClear()
  vi.stubGlobal('navigator', { userAgent: 'test-agent', sendBeacon })
  enableErrorReport()
})
afterEach(() => { disableErrorReport(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('前端错误上报边界', () => {
  it('同一请求只采集一次，保留请求号并移除页面/接口敏感查询参数', async () => {
    const error = { message: '请求失败', config: { method: 'get', url: '/test?token=private-value' }, response: { status: 500, data: { requestId: 'origin-123' } } }
    reportRequestError(error)
    reportRequestError(error)
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: error })
    window.dispatchEvent(event)
    await vi.runAllTimersAsync()
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const body = await sendBeacon.mock.calls[0]![1].text()
    const payload = JSON.parse(body)
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0].requestId).toBe('origin-123')
    expect(body).not.toContain('private-value')
  })

  it('主动取消不采集；中文长消息按实际字节拆批，避免超过 keepalive 限制', async () => {
    reportRequestError({ code: 'ERR_CANCELED', message: 'cancelled' })
    for (let i = 0; i < 20; i++) reportRequestError({ message: '错'.repeat(1000), config: { method: 'get', url: '/test/' + i } })
    await vi.runAllTimersAsync()
    expect(sendBeacon.mock.calls.length).toBeGreaterThan(1)
    let total = 0
    for (const [, body] of sendBeacon.mock.calls) {
      expect(body.size).toBeLessThanOrEqual(48 * 1024)
      const payload = JSON.parse(await body.text())
      expect(payload.events.length).toBeLessThanOrEqual(20)
      total += payload.events.length
    }
    expect(total).toBe(20)
  })
});
