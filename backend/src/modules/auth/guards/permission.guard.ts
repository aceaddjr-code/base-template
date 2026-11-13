import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { CRUD_PERM_PREFIX_KEY, resolveCrudPermCode } from '../../../common/decorators/crud-perm-prefix.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { hasAnyCode, isSystemAdmin } from '../../../common/utils/permission-check';
import { AuthService } from '../auth.service';
import type { ScopeUser } from '../../../common/utils/data-scope';

@Injectable()
export class PermissionGuard implements CanActivate {

  constructor(
    private reflector: Reflector,
    private authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 显式权限优先，其次使用标准 CRUD 方法映射。
    let codes: string[] | undefined = required?.length ? required : undefined;
    if (!codes) {
      const prefix = this.reflector.get<string>(CRUD_PERM_PREFIX_KEY, context.getClass());
      const handlerName = context.getHandler().name;
      const code = prefix ? resolveCrudPermCode(prefix, handlerName) : undefined;
      codes = code ? [code] : undefined;
    }
    // 未声明按钮权限的端点仍受全局登录守卫和端点角色规则控制。
    if (!codes || codes.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: ScopeUser }>();
    if (!user) return false;
    if (isSystemAdmin(user)) return true;

    const userCodes = await this.authService.getUserAccessCodes(user);
    if (!hasAnyCode(userCodes, codes)) return false;
    user.accessCodes = userCodes;
    return true;
  }
}
