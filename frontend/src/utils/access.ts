import { useAccessStore } from '@/stores/access'
import { currentRoles } from '@/utils/permission'

/** 基于权限码判断（菜单管理建按钮节点 + 角色勾选） */
export function hasAccessByCodes(codes: string | string[]): boolean {
  return useAccessStore().hasCode(codes)
}

/** 基于角色判断（多角色任一命中） */
export function hasAccessByRoles(roles: string | string[]): boolean {
  const list = Array.isArray(roles) ? roles : [roles]
  return list.some((r) => currentRoles().includes(r))
}
