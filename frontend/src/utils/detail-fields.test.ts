import { describe, it, expect } from 'vitest'
import { fieldsToColumns, type ColumnSourceField } from './detail-fields'

const sample: ColumnSourceField[] = [
  { label: '单据编号', dataIndex: 'docNo', width: 170, sorter: true, list: true, formatter: (record) => String(record.docNo || '-') },
  { label: '说明', dataIndex: 'description', list: true },
  { label: '单据负责人', dataIndex: 'ownerId', width: 150, formatter: (record) => `用户${record.ownerId}` },
  { label: '备注', dataIndex: 'remark' },
]

describe('fieldsToColumns（字段注册表 → 列表列）', () => {
  it('每个字段都生成一列：label→title、dataIndex→key/dataIndex', () => {
    const columns = fieldsToColumns(sample)
    expect(columns).toHaveLength(4)
    expect(columns[0]).toMatchObject({ title: '单据编号', dataIndex: 'docNo', key: 'docNo' })
    expect(columns[3]).toMatchObject({ title: '备注', dataIndex: 'remark', key: 'remark' })
  })

  it('list 缺省或 false → hidden=true（进列设置但默认不勾选）；list:true 不带 hidden', () => {
    const columns = fieldsToColumns(sample)
    expect(columns[0]).not.toHaveProperty('hidden')
    expect(columns[1]).not.toHaveProperty('hidden')
    expect(columns[2].hidden).toBe(true)
    expect(columns[3].hidden).toBe(true)
  })

  it('width / sorter 按声明传递；未声明宽度的列为弹性列（不带 width）', () => {
    const columns = fieldsToColumns(sample)
    expect(columns[0]).toMatchObject({ width: 170, sorter: true })
    expect(columns[1]).not.toHaveProperty('width')
    expect(columns[1]).not.toHaveProperty('sorter')
    expect(columns[2]).toMatchObject({ width: 150 })
    expect(columns[2]).not.toHaveProperty('sorter')
  })

  it('formatter 接线到 customRender，按 record 取值', () => {
    const columns = fieldsToColumns(sample)
    expect(columns[0].customRender({ record: { docNo: 'EX-1' } })).toBe('EX-1')
    expect(columns[2].customRender({ record: { ownerId: 7 } })).toBe('用户7')
    expect(columns[1]).not.toHaveProperty('customRender')
    expect(columns[3]).not.toHaveProperty('customRender')
  })
})
