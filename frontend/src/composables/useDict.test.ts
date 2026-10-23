import { effectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDict, getDictAll } from '@/api/dict'
import { invalidateDict, resetDictCache } from '@/utils/dict-cache'
import { useDict } from './useDict'

vi.mock('@/api/dict', () => ({ getDict: vi.fn(), getDictAll: vi.fn() }))
const result = (label: string) => ({ code: 'status', name: '状态', options: [{ label, value: 'a', color: null }] })
// useDict 同时挂全量缓存（F40 历史回显），测试只关注启用缓存行为，给全量一个可解析的默认值
const allResult = () => ({ code: 'status', name: '状态', options: [{ label: '旧值', value: 'a', color: null, status: 1 }] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => { resetDictCache(); vi.resetAllMocks(); vi.mocked(getDict).mockResolvedValue(result('旧值'))
  vi.mocked(getDictAll).mockResolvedValue(allResult()) })

describe('字典缓存公开行为', () => {
  it('同时使用同一编码合并请求，显式刷新绕过完成缓存', async () => {
    const scope = effectScope()
    const [first, second] = scope.run(() => [useDict('status'), useDict('status')])!
    await flushPromises()
    expect(getDict).toHaveBeenCalledTimes(1)
    expect(second.labelOf('a')).toBe('旧值')
    vi.mocked(getDict).mockResolvedValue(result('新值'))
    await first!.refresh()
    expect(getDict).toHaveBeenCalledTimes(2)
    expect(second!.labelOf('a')).toBe('新值')
    scope.stop()
  })

  it('管理失效会刷新挂载的使用方，旧在途结果不能覆盖新值', async () => {
    const old = deferred<ReturnType<typeof result>>()
    vi.mocked(getDict).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('已更新'))
    const scope = effectScope()
    const dict = scope.run(() => useDict('status'))!
    invalidateDict('other')
    expect(getDict).toHaveBeenCalledTimes(1)
    invalidateDict('status')
    await flushPromises()
    old.resolve(result('过期结果'))
    await flushPromises()
    expect(dict.labelOf('a')).toBe('已更新')
    expect(dict.loading.value).toBe(false)
    scope.stop()
  })

  it('账号清理清除可见数据并隔离迟到响应；新会话重新加载', async () => {
    const old = deferred<ReturnType<typeof result>>()
    vi.mocked(getDict).mockReturnValueOnce(old.promise)
    const scope = effectScope()
    const dict = scope.run(() => useDict('status'))!
    resetDictCache()
    old.resolve(result('上一账号'))
    await flushPromises()
    expect(dict.options.value).toEqual([])
    expect(dict.labelOf('a')).toBe('a')
    vi.mocked(getDict).mockResolvedValue(result('新账号'))
    await dict.refresh()
    expect(dict.labelOf('a')).toBe('新账号')
    scope.stop()
  })

  it('刷新失败保留已确认数据并暴露错误，之后仍可重试', async () => {
    const scope = effectScope()
    const dict = scope.run(() => useDict('status'))!
    await flushPromises()
    vi.mocked(getDict).mockRejectedValueOnce(new Error('offline'))
    await expect(dict.refresh()).rejects.toThrow('offline')
    expect(dict.error.value).toBeInstanceOf(Error)
    expect(dict.labelOf('a')).toBe('旧值')
    await dict.refresh()
    expect(dict.error.value).toBeUndefined()
    scope.stop()
  })
});
