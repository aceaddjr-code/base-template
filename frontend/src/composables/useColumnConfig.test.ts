import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app'
import { effectScope, nextTick, ref } from 'vue'
import { applyColumnConfig, useColumnConfig } from './useColumnConfig'

const KEY = 'starter-test-cols-hidden'

const baseCols = (): any[] => [
  { key: 'a', title: 'A' },
  { key: 'b', title: 'B' },
  { key: 'c', title: 'C', hidden: true },
  { key: 'action', title: '操作', fixed: 'right' },
]

const keys = (cols: any[]) => cols.map((c) => String(c.key ?? c.dataIndex))

describe('applyColumnConfig · 默认隐藏列（hidden）', () => {
  beforeEach(() => localStorage.clear())

  it('无本地配置时：默认隐藏列不进表格，其余列照常', () => {
    expect(keys(applyColumnConfig(baseCols(), KEY, ['action']))).toEqual(['a', 'b', 'action'])
  })

  it('用户在列设置里勾选了默认隐藏列 → 进入表格，顺序按配置', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { key: 'c', visible: true },
        { key: 'a', visible: true },
        { key: 'b', visible: false },
        { key: 'action', visible: true },
      ]),
    )
    expect(keys(applyColumnConfig(baseCols(), KEY, ['action']))).toEqual(['c', 'a', 'action'])
  })

  it('默认隐藏列未被勾选 → 不出现（配置里记录了该列且 visible=false）', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { key: 'a', visible: true },
        { key: 'b', visible: false },
        { key: 'c', visible: false },
        { key: 'action', visible: true },
      ]),
    )
    expect(keys(applyColumnConfig(baseCols(), KEY, ['action']))).toEqual(['a', 'action'])
  })

  it('新增的普通列自动补进表格（旧行为不变），新增的隐藏列不补', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { key: 'a', visible: true },
        { key: 'action', visible: true },
      ]),
    )
    const withNew = [...baseCols(), { key: 'n1', title: 'N1' }, { key: 'n2', title: 'N2', hidden: true }]
    const out = keys(applyColumnConfig(withNew, KEY, ['action']))
    expect(out).toContain('n1')
    expect(out).not.toContain('n2')
  })

  it('锁定列（操作）始终排尾', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { key: 'action', visible: true },
        { key: 'c', visible: true },
        { key: 'a', visible: true },
        { key: 'b', visible: false },
      ]),
    )
    expect(keys(applyColumnConfig(baseCols(), KEY, ['action']))).toEqual(['c', 'a', 'action'])
  })

  it('损坏配置回退时仍遵守默认隐藏，旧配置不能隐藏锁定列', () => {
    localStorage.setItem(KEY, '{bad json')
    expect(keys(applyColumnConfig(baseCols(), KEY))).toEqual(['a', 'b', 'action'])
    localStorage.setItem(KEY, JSON.stringify([{ key: 'action', visible: false }]))
    expect(keys(applyColumnConfig(baseCols(), KEY))).toEqual(['a', 'b', 'action'])
  })

  it('多个新增列按声明顺序补齐，并丢弃已删除列和重复配置', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { key: 'removed', visible: true }, { key: 'b', visible: true },
      { key: 'b', visible: true }, { key: 'action', visible: true },
    ]))
    expect(keys(applyColumnConfig([...baseCols(), { key: 'n1' }, { key: 'n2' }], KEY)))
      .toEqual(['b', 'a', 'n1', 'n2', 'action'])
  })

  it('历史列宽可迁移，但不会覆盖已保存的独立列宽', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 220 }))
    applyColumnConfig(baseCols(), KEY)
    expect(JSON.parse(localStorage.getItem(`${KEY}-width`)!)).toEqual({ a: 220 })
    expect(localStorage.getItem(KEY)).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ a: 100 }))
    applyColumnConfig(baseCols(), KEY)
    expect(JSON.parse(localStorage.getItem(`${KEY}-width`)!)).toEqual({ a: 220 })
  })

  it('来源更新、排序和全选统一遵守锁定规则；恢复默认保留最新列全集', async () => {
    const scope = effectScope()
    const source = ref(baseCols())
    const config = scope.run(() => useColumnConfig(KEY, source))!
    try {
      config.moveFieldTo(0, 1)
      expect(keys(config.visibleColumns.value)).toEqual(['b', 'a', 'action'])
      config.moveFieldTo(2, 3)
      config.moveFieldTo(3, 0)
      expect(config.fields.value.map(field => field.key)).toEqual(['b', 'a', 'c', 'action'])
      config.toggleField('action')
      config.toggleAll(false)
      expect(keys(config.visibleColumns.value)).toEqual(['action'])
      expect(config.allChecked.value).toBe(false)
      config.toggleField('a')
      expect(config.indeterminate.value).toBe(true)
      source.value = [...source.value.filter(column => column.key !== 'b'), { key: 'new', title: '新列' }]
      await nextTick()
      expect(config.fields.value.map(field => field.key)).toEqual(['a', 'c', 'new', 'action'])
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'new', 'action'])
      config.resetFields()
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'new', 'action'])
      expect(keys(config.visibleColumns.value)).toEqual(keys(applyColumnConfig(source.value, KEY)))
    } finally { scope.stop() }
  })

  it('存储拒绝访问时仍能显示、切换和恢复默认', () => {
    const scope = effectScope()
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      const config = scope.run(() => useColumnConfig(KEY, baseCols()))!
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'b', 'action'])
      expect(() => config.toggleField('a')).not.toThrow()
      expect(keys(config.visibleColumns.value)).toEqual(['b', 'action'])
      expect(() => config.resetFields()).not.toThrow()
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'b', 'action'])
    } finally { get.mockRestore(); set.mockRestore(); scope.stop() }
  })

  it('锁定 key 仅引用或重复项变化不重建偏好，实际集合变化仍更新规则', async () => {
    const scope = effectScope()
    const lockedKeys = ref(['action'])
    const config = scope.run(() => useColumnConfig(KEY, baseCols(), lockedKeys))!
    try {
      const originalFields = config.fields.value
      lockedKeys.value = ['action', 'action']
      await nextTick()
      expect(config.fields.value).toBe(originalFields)
      lockedKeys.value = ['action', 'c']
      await nextTick()
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'b', 'c', 'action'])
      config.toggleField('c')
      expect(keys(config.visibleColumns.value)).toContain('c')
    } finally { scope.stop() }
  })
})


describe('useColumnConfig · 账号隔离（F26）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('登录后偏好写入账号专属 key，旧公共 key 不被读写', () => {
    localStorage.setItem(KEY, JSON.stringify([{ key: 'a', visible: false }]))
    const store = useAppStore()
    store.userInfo = { id: 7, username: 'u7', role: 'user', displayName: '七', avatar: null, deptId: null, deptName: null }
    const scope = effectScope()
    const config = scope.run(() => useColumnConfig(KEY, baseCols()))!
    try {
      // 旧公共 key 的隐藏配置不迁入账号
      expect(keys(config.visibleColumns.value)).toEqual(['a', 'b', 'action'])
      config.toggleField('b')
      expect(localStorage.getItem(KEY + ':7')).toContain('"visible":false')
      expect(JSON.parse(localStorage.getItem(KEY)!)[0].key).toBe('a')
    } finally { scope.stop() }
  })

  it('不同账号各自恢复自己的偏好', () => {
    const store = useAppStore()
    store.userInfo = { id: 7, username: 'u7', role: 'user', displayName: '七', avatar: null, deptId: null, deptName: null }
    localStorage.setItem(KEY + ':7', JSON.stringify([{ key: 'a', visible: false }]))
    localStorage.setItem(KEY + ':8', JSON.stringify([{ key: 'b', visible: false }]))
    const scope = effectScope()
    const forSeven = scope.run(() => useColumnConfig(KEY, baseCols()))!
    expect(keys(forSeven.visibleColumns.value)).toEqual(['b', 'action'])
    scope.stop()
    store.userInfo = { ...store.userInfo, id: 8 }
    const scope2 = effectScope()
    const forEight = scope2.run(() => useColumnConfig(KEY, baseCols()))!
    expect(keys(forEight.visibleColumns.value)).toEqual(['a', 'action'])
    scope2.stop()
  })
})