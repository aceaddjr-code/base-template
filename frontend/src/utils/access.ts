import { useAccessStore } from '@/stores/access'
import { currentRoles } from '@/utils/permission'
import { useAppStore } from '@/stores/app'

/** 基于权限码判断（菜单管理建按钮节点 + 角色勾选） */
export function hasAccessByCodes(codes: string | string[]): boolean {
  return useAccessStore().hasCode(codes)
}

/** 基于角色判断（多角色任一命中） */
export function hasAccessByRoles(roles: string | string[]): boolean {
  const list = Array.isArray(roles) ? roles : [roles]
  return list.some((r) => currentRoles().includes(r))
}

/** 普通动作授权只适用于本人记录。他人记录还需对应的补充权限。 */
export function hasRecordAction(ownerId: number | null | undefined, permission: string, othersPermission = permission + '-others'): boolean {
  if (hasAccessByRoles('admin')) return true
  if (ownerId == null || !hasAccessByCodes(permission)) return false
  return ownerId === useAppStore().userInfo?.id || hasAccessByCodes(othersPermission)
}
