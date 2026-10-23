import { useAppStore } from '@/stores/app'

/** 当前用户主角色 code */
export function currentRole(): string | undefined {
  return useAppStore().userInfo?.role
}

export function currentRoles(): string[] {
  const info = useAppStore().userInfo
  return info?.roles?.length ? info.roles : (info?.role ? [info.role] : [])
}

/** 是否系统管理员（admin；多角色任一命中） */
export function isAdmin(): boolean {
  return currentRoles().includes('admin')
}

/**
 * 是否有权修改单据负责人（ownerId）：
 * 只有系统管理员可改负责人；普通用户保持本人归属
 */
export function canEditOwner(): boolean {
  return isAdmin()
}
