import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearListQueryState, useListQuery } from './useListQuery'

type Result = { list: { id: number }[]; total: number }
const result = (id = 1, total = 30): Result => ({ list: [{ id }], total })
function pending() { let resolve!: (result: Result) => void; const promise = new Promise<Result>(done => { resolve = done }); return { promise, resolve } }
function setup(load = vi.fn(async (_query: unknown, _signal: AbortSignal) => result()), account = ref<number | undefined>(1), scroll = { scrollTop: 0, scrollLeft: 0 }) {
  let state!: ReturnType<typeof useListQuery<{ keyword: string }, { id: number }>>
  const wrapper = mount(defineComponent({ setup() {
    state = useListQuery({ key: 'test-items', account: () => account.value, defaults: () => ({ keyword: '' }), normalize: query => ({ keyword: query.keyword.trim() }), load, scrollElement: () => scroll as HTMLElement })
    return () => h('div')
  } }))
  return { state, wrapper, load, account, scroll }
}
beforeEach(() => clearListQueryState())
describe('列表查询状态', () => {
  it('编辑输入不改变请求和已应用快照，翻页使用原条件，查询回到第一页', async () => {
    const { state, wrapper, load } = setup()
    await flushPromises()
    state.draft.value.keyword = ' 未提交 '
    expect(state.dirty.value).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    await state.changePage(2)
    expect(load.mock.lastCall?.[0]).toMatchObject({ keyword: '', page: 2 })
    expect(state.activeQuery.value.keyword).toBe('')
    await state.apply()
    expect(load.mock.lastCall?.[0]).toMatchObject({ keyword: '未提交', page: 1 })
    expect(state.dirty.value).toBe(false)
    wrapper.unmount()
  })
  it('取消旧请求，并且无视忽略 AbortSignal 的迟到返回', async () => {
    const first = pending(), second = pending()
    const load = vi.fn<(_query: unknown, signal: AbortSignal) => Promise<Result>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { state, wrapper } = setup(load)
    const applied = state.apply({ keyword: '新条件' })
    expect(load.mock.calls[0]![1].aborted).toBe(true)
    second.resolve(result(2)); await applied
    first.resolve(result(1)); await flushPromises()
    expect(state.rows.value).toEqual([{ id: 2 }])
    expect(state.loading.value).toBe(false)
    wrapper.unmount()
  })
  it('失败清除旧数据，重试可恢复；删除末页记录后回到实际最后一页', async () => {
    const load = vi.fn(async (_query: unknown, _signal: AbortSignal) => result())
    const { state, wrapper } = setup(load)
    await flushPromises()
    load.mockRejectedValueOnce(new Error('failed'))
    await state.apply({ keyword: '失败条件' })
    expect(state.failed.value).toBe(true)
    expect(state.rows.value).toEqual([])
    expect(state.total.value).toBe(0)
    await state.refresh()
    expect(state.failed.value).toBe(false)
    load.mockResolvedValueOnce(result(0, 10)).mockResolvedValueOnce(result(3, 10))
    await state.changePage(3)
    expect(state.page.value).toBe(1)
    expect(state.rows.value).toEqual([{ id: 3 }])
    wrapper.unmount()
  })
  it('返回列表恢复应用条件、页码、排序和滚动，不恢复未提交输入', async () => {
    const one = setup()
    await flushPromises()
    await one.state.apply({ keyword: '已查询' })
    await one.state.changeSort({ sortBy: 'title', sortOrder: 'ASC' })
    await one.state.changePage(2)
    one.scroll.scrollTop = 130; one.scroll.scrollLeft = 48
    one.state.draft.value.keyword = '草稿'
    one.wrapper.unmount()
    const two = setup()
    await flushPromises()
    expect(two.load.mock.lastCall?.[0]).toMatchObject({ keyword: '已查询', page: 2, sortBy: 'title', sortOrder: 'ASC' })
    expect(two.state.draft.value.keyword).toBe('已查询')
    expect(two.scroll).toEqual({ scrollTop: 130, scrollLeft: 48 })
    two.wrapper.unmount()
  })
  it('账号切换与退出清空缓存；离开页面取消请求且不写入迟到结果', async () => {
    const deferred = pending()
    const one = setup(vi.fn(() => deferred.promise))
    one.account.value = 2
    deferred.resolve(result()); await flushPromises()
    expect(one.state.rows.value).toEqual([])
    const later = pending()
    one.load.mockReturnValueOnce(later.promise)
    const request = one.state.refresh()
    one.wrapper.unmount()
    expect(one.load.mock.lastCall?.[1].aborted).toBe(true)
    later.resolve(result(9)); await request
    expect(one.state.rows.value).toEqual([])
    clearListQueryState()
    const two = setup()
    expect(two.state.draft.value.keyword).toBe('')
    two.wrapper.unmount()
  })
  it('回车查询带输入法守卫；页脚总数文案按失败/查询中/正常三态', async () => {
    const { state, wrapper, load } = setup()
    await flushPromises()
    state.draft.value.keyword = '输入中'
    state.onSearchEnter({ isComposing: true, keyCode: 229 } as KeyboardEvent)
    state.onSearchEnter({ isComposing: false, keyCode: 13 } as KeyboardEvent)
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.lastCall?.[0]).toMatchObject({ keyword: '输入中', page: 1 })
    expect(state.totalText.value(30)).toBe('共 30 条')
    const stuck = pending()
    load.mockReturnValueOnce(stuck.promise)
    void state.refresh()
    await flushPromises()
    expect(state.totalText.value(30)).toBe('查询中…')
    stuck.resolve(result())
    await flushPromises()
    load.mockRejectedValueOnce(new Error('failed'))
    await state.refresh()
    expect(state.totalText.value(30)).toBe('数量暂不可用')
    wrapper.unmount()
  })
})
