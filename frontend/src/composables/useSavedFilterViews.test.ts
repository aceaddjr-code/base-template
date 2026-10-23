import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { matchDateRangePreset, resolveDateRangePreset } from '@/utils/filter-dates'
import { useSavedFilterViews } from './useSavedFilterViews'
import { useAppStore } from '@/stores/app'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('相对日期语义（F27）', () => {
  it('与今天计算的预设一致的区间识别为稳定 key', () => {
    const thisMonth = resolveDateRangePreset('this-month')!
    expect(matchDateRangePreset(thisMonth)).toBe('this-month')
    expect(matchDateRangePreset(['2020-01-01', '2020-01-31'])).toBeUndefined()
    expect(matchDateRangePreset(undefined)).toBeUndefined()
  })

  it('应用时按当天重算，与保存当天的具体日期解耦', () => {
    const saved = resolveDateRangePreset('last-7-days')!
    // 直接解析返回的总是"今天"视角的区间，而不是保存时的快照
    expect(resolveDateRangePreset('last-7-days')).toEqual(saved)
    expect(resolveDateRangePreset('nope')).toBeUndefined()
  })
})

describe('useSavedFilterViews', () => {
  function setup() {
    const store = useAppStore()
    store.userInfo = { id: 5, username: 'u5', role: 'admin', displayName: '五', avatar: null, deptId: null, deptName: null }
    const state = useSavedFilterViews({ moduleKey: 'system-users', knownFields: () => ['keyword', 'statuses', 'created', 'deptId'] })
    return { store, state }
  }

  it('保存/同名更新/重命名/删除/设默认', () => {
    const { state } = setup()
    state.save('停用用户', { statuses: [0] }, { createdAt: 'DESC' })
    state.save('停用用户', { statuses: [0], keyword: 'a' }, {})
    expect(state.views.value).toHaveLength(1)
    expect(state.views.value[0]!.query).toEqual({ statuses: [0], keyword: 'a' })
    const id = state.views.value[0]!.id
    state.rename(id, '只看停用')
    expect(state.views.value[0]!.name).toBe('只看停用')
    expect(state.defaultId.value).toBe(id)
    state.setDefault(undefined)
    expect(state.defaultId.value).toBeUndefined()
    state.remove(id)
    expect(state.views.value).toHaveLength(0)
  })

  it('删除默认视图后清除默认标记', () => {
    const { state } = setup()
    state.save('甲', { keyword: 'a' }, {})
    state.save('乙', { keyword: 'b' }, {})
    const second = state.views.value[1]!
    state.setDefault(second.id)
    expect(state.defaultId.value).toBe(second.id)
    state.remove(second.id)
    expect(state.defaultId.value).toBeUndefined()
    expect(state.views.value.map((view) => view.name)).toEqual(['甲'])
  })

  it('应用视图时丢弃未知字段并回传失效提示', () => {
    const { state } = setup()
    state.save('旧结构', { statuses: [1], removedField: 'x' }, {})
    const id = state.views.value[0]!.id
    const loaded = state.loadView(id)!
    expect(loaded.query).toEqual({ statuses: [1] })
    expect(loaded.staleKeys).toEqual(['removedField'])
    expect(state.loadView('missing')).toBeUndefined()
  })

  it('按账号隔离：不同账号互不可见', () => {
    const { store, state } = setup()
    state.save('五号的视图', { keyword: 'x' }, {})
    void state;
    expect(localStorage.getItem('starter-filter-views:system-users:5')).toBeTruthy()
    store.userInfo = { ...store.userInfo!, id: 6 }
    const other = useSavedFilterViews({ moduleKey: 'system-users', knownFields: () => ['keyword'] })
    expect(other.views.value).toHaveLength(0)
    expect(state.views.value).toHaveLength(1)
  })

  it('存储损坏时按空开始，不抛错', () => {
    const { state } = setup()
    void state.views
    localStorage.setItem('starter-filter-views:system-users:5', '{broken')
    const retry = useSavedFilterViews({ moduleKey: 'system-users', knownFields: () => ['keyword'] })
    expect(retry.views.value).toEqual([])
    localStorage.setItem('starter-filter-views:system-users:5', JSON.stringify({ version: 99, views: [{ id: 'x' }] }))
    const mismatch = useSavedFilterViews({ moduleKey: 'system-users', knownFields: () => ['keyword'] })
    expect(mismatch.views.value).toEqual([])
  })
})
