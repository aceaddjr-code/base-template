import { describe, it, expect } from 'vitest'
import { buildExampleFields } from './example-fields'

const deps = {
  userLabel: (id: number | null | undefined) => `用户${id ?? '-'}`,
  categoryLabel: (value: string | null | undefined) => `类别:${value ?? '-'}`,
  categoryOptions: [{ label: '常规', value: 'normal' }],
}

/** 与后端 example.service.ts sortableFields 白名单保持一致 */
const SORTABLE_WHITELIST = ['docNo', 'title', 'status', 'createdAt', 'updatedAt']

describe('buildExampleFields（示例事项字段注册表：详情与列表单一来源）', () => {
  const fields = buildExampleFields(deps)

  it('覆盖详情全部字段，含动态信息与备注', () => {
    expect(fields.map((field) => field.dataIndex)).toEqual([
      'docNo', 'title', 'status', 'category', 'description',
      'ownerId', 'createdBy', 'createdAt', 'updatedAt', 'remark',
    ])
  })

  it('默认上列表的只有原有 6 列；新增字段仅进列设置（默认不勾选）', () => {
    const defaultVisible = fields.filter((field) => field.list).map((field) => field.dataIndex)
    expect(defaultVisible).toEqual(['docNo', 'title', 'status', 'category', 'description', 'updatedAt'])
    for (const key of ['ownerId', 'createdBy', 'createdAt', 'remark']) {
      expect(fields.find((field) => field.dataIndex === key)?.list).toBeFalsy()
    }
  })

  it('sorter 只出现在后端 sortableFields 白名单键上（防任意排序注入）', () => {
    for (const field of fields) {
      if (!field.sorter) continue
      expect(SORTABLE_WHITELIST).toContain(field.dataIndex)
    }
  })

  it('人员/类别/时间字段的 formatter 走注入的取值口径', () => {
    const record = { ownerId: 7, createdBy: 8, category: 'normal', createdAt: '2026-01-02 03:04:05', docNo: '' }
    const byKey = Object.fromEntries(fields.map((field) => [field.dataIndex, field]))
    expect(byKey.ownerId.formatter!(record)).toBe('用户7')
    expect(byKey.createdBy.formatter!(record)).toBe('用户8')
    expect(byKey.category.formatter!(record)).toBe('类别:normal')
    expect(byKey.docNo.formatter!(record)).toBe('-')
    expect(byKey.createdAt.formatter!(record)).toContain('2026')
  })

  it('编辑字段与新增弹窗字段一致（title/status/category/description/remark）', () => {
    const editable = fields.filter((field) => field.editable).map((field) => field.dataIndex)
    expect(editable.sort()).toEqual(['category', 'description', 'remark', 'status', 'title'])
  })

  it('类别编辑候选由 deps 注入（抽屉传启用项，列表侧可不传）', () => {
    expect(buildExampleFields({ userLabel: deps.userLabel, categoryLabel: deps.categoryLabel })
      .find((field) => field.dataIndex === 'category')?.options).toBeUndefined()
    expect(fields.find((field) => field.dataIndex === 'category')?.options).toEqual(deps.categoryOptions)
  })
})
