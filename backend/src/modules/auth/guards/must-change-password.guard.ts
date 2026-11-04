import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ALLOW_DURING_PASSWORD_CHANGE_KEY } from '../decorators/allow-during-password-change.decorator';
import { ACCOUNT_SECURITY_REASONS } from '../account-security.contracts';
import type { JwtPayload } from '../jwt.strategy';

/**
 * 待改密门禁（规格 3.3）：在 JWT 校验完成之后、角色/操作权限放行之前执行，
 * admin 同样受限。待改密标志来自 JwtStrategy 每次鉴权的数据库读回。
 * 白名单外的一切受保护接口返回 403 + PASSWORD_CHANGE_REQUIRED；
 * 公共接口（@Public）不经 JWT，本守卫直接放行，语义不变。
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    // 未认证请求交给后续守卫/异常处理；这里只裁决待改密受限会话。
    if (!user?.mustChangePassword) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_CHANGE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      message: '请先完成初始密码修改',
      reason: ACCOUNT_SECURITY_REASONS.PASSWORD_CHANGE_REQUIRED,
    });
  }
}
