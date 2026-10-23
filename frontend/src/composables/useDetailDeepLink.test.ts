import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'

const route = reactive<{ path: string; query: Record<string, any> }>({ path: '/demo/list', query: {} })
const replace = vi.fn(() => Promise.resolve())

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}))

const { useDetailDeepLink } = await import('./useDetailDeepLink')

describe('useDetailDeepLink · 详情直达', () => {
  beforeEach(() => {
    route.path = '/demo/list'
    route.query = {}
    replace.mockClear()
  })

  it('挂载时带 ?detail 打开详情，并把直达参数从 URL 清掉', async () => {
    const open = vi.fn()
    route.query = { detail: '12' }
    useDetailDeepLink(open).attach()
    await nextTick()

    expect(open).toHaveBeenCalledWith(12, undefined)
    expect(replace).toHaveBeenCalledWith({ path: '/demo/list', query: {} })
  })

  it('tab 参数透传（设计模块 ?detail=id&tab=tasks）', async () => {
    const open = vi.fn()
    route.query = { detail: '7', tab: 'tasks' }
    useDetailDeepLink(open).attach()
    await nextTick()

    expect(open).toHaveBeenCalledWith(7, 'tasks')
  })

  it('保留其它 query（列表筛选/keyword），只删 detail 与 tab', async () => {
    const open = vi.fn()
    route.query = { keyword: 'abc', detail: '9', tab: 'tasks' }
    useDetailDeepLink(open).attach()
    await nextTick()

    expect(replace).toHaveBeenCalledWith({ path: '/demo/list', query: { keyword: 'abc' } })
  })

  it('无 ?detail 时不打开、不改 URL', async () => {
    const open = vi.fn()
    useDetailDeepLink(open).attach()
    await nextTick()

    expect(open).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('非法 id（空串/非数字/0/负数）不动作', async () => {
    const open = vi.fn()
    route.query = { detail: 'abc' }
    useDetailDeepLink(open).attach()
    await nextTick()
    route.query = { detail: '0' }
    await nextTick()
    route.query = { detail: '-3' }
    await nextTick()

    expect(open).not.toHaveBeenCalled()
  })

  it('同页 detail 变化（通知直达另一单据）重新打开', async () => {
    const open = vi.fn()
    route.query = { detail: '1' }
    useDetailDeepLink(open).attach()
    await nextTick()

    route.query = { detail: '2' }
    await nextTick()
    expect(open).toHaveBeenLastCalledWith(2, undefined)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('打开抛错时仍清理直达参数（用户可再点一次重试）', async () => {
    const open = vi.fn(() => { throw new Error('boom') })
    route.query = { detail: '5' }
    useDetailDeepLink(open).attach()
    await nextTick()

    expect(replace).toHaveBeenCalledWith({ path: '/demo/list', query: {} })
  })
})
