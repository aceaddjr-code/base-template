import { describe, expect, it } from 'vitest'
import { buildPrintDocument, collectPrintRows, resolveFieldValue, type PrintFieldLike } from './print-document'

const baseField: PrintFieldLike = { label: '标题', dataIndex: 'title' }

describe('F21 打印字段取值（与详情抽屉查看态同口径）', () => {
  it('boolean 渲染是/否，空值为 -', () => {
    const field: PrintFieldLike = { label: '启用', dataIndex: 'enabled', valueType: 'boolean' }
    expect(resolveFieldValue(field, { enabled: true })).toBe('是')
    expect(resolveFieldValue(field, { enabled: false })).toBe('否')
    expect(resolveFieldValue(field, { enabled: null })).toBe('-')
  })

  it('formatter 优先且空结果回落为 -；tag 取原始值的文本', () => {
    const withFormatter: PrintFieldLike = { label: '状态', dataIndex: 'status', formatter: (record) => (record.status === 'pending' ? '待处理' : '') }
    expect(resolveFieldValue(withFormatter, { status: 'pending' })).toBe('待处理')
    expect(resolveFieldValue(withFormatter, { status: 'other' })).toBe('-')
    const tag: PrintFieldLike = { label: '级别', dataIndex: 'level', valueType: 'tag' }
    expect(resolveFieldValue(tag, { level: 'high' })).toBe('high')
    expect(resolveFieldValue(tag, { level: null })).toBe('-')
  })

  it('缺省走日期格式化，普通字符串原样，空值 -', () => {
    expect(resolveFieldValue(baseField, { title: '  文本 ' })).toBe('  文本 ')
    expect(resolveFieldValue(baseField, { title: null })).toBe('-')
    expect(resolveFieldValue(baseField, { title: '' })).toBe('-')
    expect(resolveFieldValue({ label: '时间', dataIndex: 'at' }, { at: '2026-10-23T03:00:00.000Z' })).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('collectPrintRows 跳过 hidden 并补创建/修改时间', () => {
    const fields: PrintFieldLike[] = [
      { ...baseField },
      { label: '内部', dataIndex: 'secret', hidden: () => true },
    ]
    const rows = collectPrintRows(fields, { title: 'T', secret: 'x', createdAt: '2026-10-23T03:00:00.000Z' })
    expect(rows.map((row) => row.label)).toEqual(['标题', '创建时间'])
    const withoutAudit = collectPrintRows(fields, { title: 'T', createdAt: 'x' }, { showAuditTime: false })
    expect(withoutAudit.map((row) => row.label)).toEqual(['标题'])
  })
})

describe('F21 打印文档生成', () => {
  it('A4 样式、范围声明、系统名称与编号齐全', () => {
    const html = buildPrintDocument({
      title: '示例事项详情',
      systemName: '测试系统',
      recordId: 7,
      rows: [{ label: '标题', value: '一条记录' }],
      printedAt: new Date(2026, 9, 23, 10, 30),
      scopeNote: '打印范围：当前查看的单据详情。',
    })
    expect(html).toContain('@page { size: A4;')
    expect(html).toContain('测试系统')
    expect(html).toContain('示例事项详情')
    expect(html).toContain('编号：7')
    expect(html).toContain('打印时间：2026-10-23 10:30')
    expect(html).toContain('打印范围：当前查看的单据详情。')
    expect(html).toContain('<th scope="row">标题</th>')
    expect(html).toContain('<td>一条记录</td>')
  })

  it('动态值全部转义，不输出可执行标记', () => {
    const html = buildPrintDocument({
      title: '详情<script>alert(1)</script>',
      rows: [{ label: '说明', value: '<img src=x onerror=alert(1)>' }],
      printedAt: new Date(),
      scopeNote: '打印范围：当前查看的单据详情。',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
