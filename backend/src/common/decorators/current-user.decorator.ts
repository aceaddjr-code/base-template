import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 从请求中提取当前登录用户信息
 * 用法：@CurrentUser() user: JwtPayload
 */
interface RequestWithUser {
  user?: Record<string, unknown>;
}

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (data && user) {
      return user[data];
    }
    return user;
  },
);
