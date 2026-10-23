import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * 角色权限装饰器
 * 用法：@Roles('admin') 或 @Roles('admin', 'user')
 * 配合 RolesGuard 使用，限制只有指定角色的用户才能访问
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
