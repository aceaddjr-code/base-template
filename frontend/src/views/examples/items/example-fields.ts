import type { DetailField } from '@/components/DetailDrawer.vue'
import type { ColumnSourceField } from '@/utils/detail-fields'
import { formatDateTime } from '@/utils/format'
import { statusColor, statusLabel, statusOptions } from './example-options'

/** 示例事项字段：详情展示/编辑属性 + 列表派生属性（list/width/sorter）合一 */
export type ExampleField = DetailField & ColumnSourceField

export interface ExampleFieldDeps {
  /** 人员 ID → 姓名标签（读 useUserOptions；惰性求值，列表页构建一次即可跟随加载刷新） */
  userLabel: (id: number | null | undefined) => string
  /** 类别值 → 显示文字（字典口径：启用项显示名称，存量停用值回显「名称（已停用）」） */
  categoryLabel: (value: string | null | undefined) => string
  /** 类别编辑候选（字典启用项，仅详情抽屉编辑态需要；列表侧不传） */
  categoryOptions?: { label: string; value: string | number }[]
  /** 团队成员编辑候选（users/simple 启用用户，仅编辑态需要；列表侧不传） */
  memberOptions?: { label: string; value: number }[]
}

/**
 * 示例事项字段注册表：详情抽屉与列表列的单一来源。
 * 新增字段只改这里——详情自动展示、列设置自动出现（未标 list: true 时默认不勾选，勾选后才上列表）；
 * 可排序的键必须在后端 sortableFields 白名单内（docNo / title / status / createdAt / updatedAt）。
 */
export function buildExampleFields(deps: ExampleFieldDeps): ExampleField[] {
  return [
    { group: '基础信息', label: '单据编号', dataIndex: 'docNo', formatter: (record: Record<string, any>) => record.docNo || '-', list: true, width: 170, sorter: true },
    { group: '基础信息', label: '标题', dataIndex: 'title', editable: true, required: true, maxLength: 100, list: true, width: 220, sorter: true },
    { group: '基础信息', label: '状态', dataIndex: 'status', valueType: 'tag', tagColor: statusColor, formatter: (record: Record<string, any>) => statusLabel(String(record.status)), editable: true, required: true, inputType: 'select', options: statusOptions, list: true, width: 110 },
    { group: '基础信息', label: '类别', dataIndex: 'category', editable: true, inputType: 'select', options: deps.categoryOptions, formatter: (record: Record<string, any>) => deps.categoryLabel(record.category as string | null | undefined), list: true, width: 130 },
    { group: '基础信息', label: '说明', dataIndex: 'description', span: 2, editable: true, inputType: 'textarea', maxLength: 500, list: true },
    { group: '动态信息', label: '单据负责人', dataIndex: 'ownerId', formatter: (record: Record<string, any>) => deps.userLabel(record.ownerId), width: 150 },
    // 团队成员：默认不勾选，勾选后才上列表；编辑候选由抽屉传 memberOptions
    { group: '动态信息', label: '团队成员', dataIndex: 'memberIds', editable: true, inputType: 'select', multiple: true, options: deps.memberOptions, formatter: (record: Record<string, any>) => ((record.memberIds as number[] | undefined) ?? []).map(deps.userLabel).join('、') || '-', width: 160 },
    { group: '动态信息', label: '创建人', dataIndex: 'createdBy', formatter: (record: Record<string, any>) => deps.userLabel(record.createdBy), width: 140 },
    { group: '动态信息', label: '创建时间', dataIndex: 'createdAt', formatter: (record: Record<string, any>) => formatDateTime(record.createdAt), width: 180 },
    { group: '动态信息', label: '修改时间', dataIndex: 'updatedAt', formatter: (record: Record<string, any>) => formatDateTime(record.updatedAt), list: true, width: 180, sorter: true },
    { group: '备注信息', label: '备注', dataIndex: 'remark', span: 2, editable: true, inputType: 'textarea', maxLength: 500 },
  ]
}
