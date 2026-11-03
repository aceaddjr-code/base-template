/**
 * 详情字段 → 表格列 派生器。
 * 业务模块用「字段注册表」单一来源声明字段（详情抽屉 fields 与列表列共用同一份）：
 * 新增字段只需登记注册表，即自动出现在列设置（list 不为 true 时默认不勾选，勾选后才上列表）。
 * 后端导出白名单（excelColumns）与列表可勾选字段需保持对齐，否则勾选列导出时会缺列。
 */

/** 字段注册表的列表派生属性（叠加在 DetailField 结构上；结构兼容，不直接依赖 SFC 导出类型） */
export interface ColumnSourceField {
  /** 展示名：详情 label 与列表 title 共用 */
  label: string
  dataIndex: string
  /** 单元格文本：详情与列表共用同一取值口径（如人员 ID → 姓名） */
  formatter?: (record: Record<string, any>) => string
  /** 默认是否在列表展示；缺省 false = 只进列设置勾选项 */
  list?: boolean
  /** 列宽（px）；缺省为弹性列（不给宽度，吸收表格剩余宽度） */
  width?: number
  /** 列表排序；键必须与后端 sortableFields 白名单一致 */
  sorter?: boolean
}

/**
 * 字段注册表 → antd 表格列定义。
 * 已有专属渲染的列（编号链接、彩色标签、长文本样式）由页面 #bodyCell 分支接管：
 * 槽位未命中的 key 只渲染注释节点，antd 会回落到列 customRender，两条路径互不干扰。
 */
export function fieldsToColumns(fields: readonly ColumnSourceField[]): Record<string, any>[] {
  return fields.map((field) => ({
    title: field.label,
    dataIndex: field.dataIndex,
    key: field.dataIndex,
    ...(field.width != null ? { width: field.width } : {}),
    ...(field.sorter ? { sorter: true } : {}),
    // 默认不在列表展示：useColumnConfig 以 hidden=true 生成「未勾选但可勾选」的面板项
    ...(field.list ? {} : { hidden: true }),
    ...(field.formatter ? { customRender: ({ record }: { record: Record<string, any> }) => field.formatter!(record) } : {}),
  }))
}
