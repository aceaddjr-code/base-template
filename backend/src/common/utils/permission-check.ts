export function hasAnyCode(codes: string[], required: string[]): boolean {
  return !!codes && !!required && required.some((c) => codes.includes(c));
}

/** 系统管理员是初始化与系统管理例外；其他角色名不表达资格。 */
export function isSystemAdmin(user?: { roleCode?: string; roles?: string[] } | null): boolean {
  return (user?.roles?.length ? user.roles : [user?.roleCode]).includes('admin');
}
