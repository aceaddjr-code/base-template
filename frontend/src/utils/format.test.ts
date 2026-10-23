import { describe, it, expect } from 'vitest'
import { h, isVNode } from 'vue'
import { mount } from '@vue/test-utils'
import Table from 'ant-design-vue/es/table'
import { EMPTY_DASH, dash, dashNode, isEmptyValue, withEmptyDash } from './format'

describe('isEmptyValue（空值判定唯一口径）', () => {
  it('null / undefined / 空串 / 纯空格串 视为空', () => {
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue('\t\n')).toBe(true)
  })

  it('空数组视为空', () => {
    expect(isEmptyValue([])).toBe(true)
    expect(isEmptyValue([1])).toBe(false)
  })

  it('0 与 false 是有效业务值，不得判为空', () => {
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue('0')).toBe(false)
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue('否')).toBe(false)
  })
})

describe('dash / dashNode（占位输出）', () => {
  it('空值输出 -', () => {
    expect(dash(null)).toBe(EMPTY_DASH)
    expect(dash('')).toBe(EMPTY_DASH)
    expect(dash('  ')).toBe(EMPTY_DASH)
  })

  it('有值原样输出，0 不被吞掉', () => {
    expect(dash(0)).toBe('0')
    expect(dash('XMFH-01')).toBe('XMFH-01')
  })

  it('dashNode 空值返回带 cell-dash 的 VNode，有值返回原值', () => {
    const node = dashNode(null)
    expect(isVNode(node)).toBe(true)
    expect((node as any).props.class).toBe('cell-dash')
    expect((node as any).children).toBe(EMPTY_DASH)
    expect(dashNode(0)).toBe(0)
    expect(dashNode('有值')).toBe('有值')
  })
})

describe('withEmptyDash（列定义注入规则）', () => {
  it('给有 dataIndex 且无 customRender 的列注入兜底', () => {
    const [col] = withEmptyDash([{ title: '事项', dataIndex: 'itemCode', key: 'itemCode' }] as any[])
    expect(typeof col.customRender).toBe('function')
    expect(isVNode(col.customRender({ text: null }))).toBe(true)
    expect(col.customRender({ text: 0 })).toBe(0)
  })

  it('已有 customRender 的列原样保留（不覆盖页面显式意图）', () => {
    const own = { title: '序号', dataIndex: 'i', key: 'i', customRender: () => 'R' }
    const [col] = withEmptyDash([own] as any[])
    expect(col).toBe(own)
    expect(col.customRender()).toBe('R')
  })

  it('无 dataIndex 的列跳过（操作列 / 序号列 / 依赖 #bodyCell 的动态列）', () => {
    const noIdx = { title: '操作', key: 'action' }
    const stageCol = { title: '阶段', key: 'stage-1' }
    const [a, b] = withEmptyDash([noIdx, stageCol] as any[])
    expect(a.customRender).toBeUndefined()
    expect(b.customRender).toBeUndefined()
  })

  it('type=selection/index 的列跳过', () => {
    const [col] = withEmptyDash([{ title: '', type: 'index', key: 'idx' }] as any[])
    expect(col.customRender).toBeUndefined()
  })

  it('except 指定的列跳过', () => {
    const [col] = withEmptyDash([{ title: 'X', dataIndex: 'x', key: 'x' }] as any[], { except: ['x'] })
    expect(col.customRender).toBeUndefined()
  })

  it('分组表头 children 递归处理', () => {
    const [group] = withEmptyDash([{ title: '组', children: [{ title: '内', dataIndex: 'y', key: 'y' }] }] as any[])
    expect(typeof group.children[0].customRender).toBe('function')
  })

  it('不修改传入数组（返回新数组），重复包裹不叠加', () => {
    const src = [{ title: 'X', dataIndex: 'x', key: 'x' }] as any[]
    const once = withEmptyDash(src)
    expect(src[0].customRender).toBeUndefined()
    const twice = withEmptyDash(once)
    expect(twice[0]).toBe(once[0]) // 已注入的列带 customRender → 原样返回
  })
})

describe('表格渲染（ant-design-vue Table 真实交互）', () => {
  const rows = [{ id: 1, itemCode: null, qty: 0, owner: null, blank: '   ' }]
  const build = () =>
    withEmptyDash([
      { title: '事项', dataIndex: 'itemCode', key: 'itemCode' },
      { title: '数量', dataIndex: 'qty', key: 'qty' },
      { title: '纯空格', dataIndex: 'blank', key: 'blank' },
      { title: '操作人', dataIndex: 'owner', key: 'owner', customRender: ({ text }: any) => text ?? '页面自己的兜底' },
    ] as any[])

  it('空值单元格渲染灰色 -，0 值保留为 0', () => {
    const wrapper = mount(Table, {
      props: { columns: build(), dataSource: rows, pagination: false, rowKey: 'id' },
    })
    const html = wrapper.html()
    expect(html).toContain('cell-dash')
    const cells = wrapper.findAll('td')
    const texts = cells.map((c) => c.text())
    expect(texts).toContain('-') // 空值占位
    expect(texts).toContain('0') // 0 未被吞
    expect(texts.filter((t) => t === '-').length).toBe(2) // itemCode + blank(纯空格)
  })

  it('页面自带 customRender 的列仍然用自己的渲染（不被兜底覆盖）', () => {
    const wrapper = mount(Table, {
      props: { columns: build(), dataSource: rows, pagination: false, rowKey: 'id' },
    })
    expect(wrapper.html()).toContain('页面自己的兜底')
  })

  it('#bodyCell 分支优先于注入的兜底（页面既有渲染不被打乱）', () => {
    const wrapper = mount(Table, {
      props: { columns: build(), dataSource: rows, pagination: false, rowKey: 'id' },
      slots: {
        bodyCell: ({ column }: any) => (column.key === 'itemCode' ? h('a', { class: 'link-cell' }, '链接') : null),
      },
    })
    const html = wrapper.html()
    expect(html).toContain('link-cell')
    expect(html).toContain('链接')
    // 该列被分支接管后不再是 '-'
    const texts = wrapper.findAll('td').map((c) => c.text())
    expect(texts.filter((t) => t === '-').length).toBe(1)
  })
})
