/**
 * 附件关联的业务模块注册表（前端展示与穿透用）：
 * key 与后端 backend/src/modules/attachment/attachment-targets.registry.ts 的 sourceType 对齐。
 * 新业务复制示例模块接入附件时在这里登记一行：label 用于「所属模块」列，
 * path + tab 用于点击穿透到单据详情（目标页 useDetailDeepLink 消费 ?detail=<id>&tab=<tab>）。
 */
export interface AttachmentTargetMeta {
  label: string
  /** 单据列表页路由；穿透时携带 query：detail=单据 id、tab=详情页签 */
  path: string
  tab?: string
  /** 进入单据详情所需权限码；无权限时穿透入口置灰 */
  accessCode?: string
}

export const ATTACHMENT_TARGET_META: Record<string, AttachmentTargetMeta> = {
  'example-items': { label: '示例事项', path: '/examples/items', tab: 'attachments', accessCode: 'example-items:view' },
}

/** 所属模块显示名：未登记的类型原样显示技术标识 */
export function attachmentTargetLabel(entityType: string | null | undefined): string {
  if (!entityType) return ''
  return ATTACHMENT_TARGET_META[entityType]?.label ?? entityType
}
