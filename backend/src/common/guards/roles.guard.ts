import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 没有 @Roles() 装饰器 → 放行（交给其他守卫处理）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{
      user?: { roleCode: string; roles?: string[] };
    }>();

    // 没有用户信息 → 拒绝
    if (!user) {
      return false;
    }

    const userRoles = user.roles?.length ? user.roles : [user.roleCode];
    if (userRoles.includes('admin')) return true;
    return requiredRoles.some((r) => userRoles.includes(r));
  }
}
