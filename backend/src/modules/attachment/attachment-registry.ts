import type { JwtPayload } from '../auth/jwt.strategy';

/**
 * 附件绑定目标注册表（F08）：业务模块把自己的实体类型与访问校验器登记到这里后，
 * 才允许把附件 bind 到该类型；下载/删除已绑定附件时按登记的校验器裁决，
 * 未登记类型不允许绑定——避免附件成为绕过记录授权的旁路。
 */
export type AttachmentAccessChecker = (entityId: number, user: JwtPayload) => Promise<boolean> | boolean;

const registry = new Map<string, { label: string; canView: AttachmentAccessChecker }>();

export function registerAttachmentTarget(entityType: string, label: string, canView: AttachmentAccessChecker): void {
  registry.set(entityType, { label, canView });
}

export function getAttachmentTarget(entityType: string): { label: string; canView: AttachmentAccessChecker } | undefined {
  return registry.get(entityType);
}

/** 下载/删除已绑定附件的访问裁决：登记了校验器按其结果；未登记类型仅上传者与管理员可访问 */
export async function canAccessBoundAttachment(entityType: string, entityId: number, user: JwtPayload, isUploader: boolean, isAdmin: boolean): Promise<boolean> {
  if (isUploader || isAdmin) return true;
  const target = getAttachmentTarget(entityType);
  if (!target) return false;
  return Boolean(await target.canView(entityId, user));
}
