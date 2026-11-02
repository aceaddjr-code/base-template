/**
 * 附件挂接目标注册表：声明式静态元数据（sourceType / 业务表名 / 业务数据范围 scopeKey），
 * 供附件中心对业务附件做「跟随单据数据范围」的列表可见性 EXISTS 子查询与下载裁决。
 * 这是常量元数据表，不是 ADR-0001 已删除的运行时访问校验器；新业务复制示例模块时在这里登记一行，
 * 并保持 sourceType 与业务模块 ChildSpec 的 sourceType、scopeKey 与业务模块 dataScopeKey 一致。
 */
export const ATTACHMENT_TARGET_REGISTRY = [
  { sourceType: 'example-items', table: 'example_items', scopeKey: 'example-items' },
] as const;

export type AttachmentTarget = (typeof ATTACHMENT_TARGET_REGISTRY)[number];

export function findAttachmentTarget(entityType: string | null | undefined): AttachmentTarget | null {
  if (!entityType) return null;
  return ATTACHMENT_TARGET_REGISTRY.find(target => target.sourceType === entityType) ?? null;
}
