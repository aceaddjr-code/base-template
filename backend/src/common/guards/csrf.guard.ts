import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { Request } from 'express';

/**
 * CSRF 防护守卫
 * 使用 httpOnly Cookie 后，需要防止跨站请求伪造
 * 策略：检查非 GET 请求是否带有合法的 Content-Type（CSRF 表单无法设置）
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // GET/HEAD/OPTIONS 不需要 CSRF 保护
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    // 公开路由（如登录）跳过 CSRF 检查
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // 验证 Content-Type（跨站表单无法设置 application/json）
    // 无 body 的请求（Content-Type 为空）不检查 — 跨站表单无法构造空 body 的 DELETE/PUT
    const contentType = request.headers['content-type'];
    if (
      contentType
      && !contentType.includes('application/json')
      && !contentType.includes('multipart/form-data')
    ) {
      return false;
    }

    // 且 Chromium 登录后 ~2 分钟 Lax+POST 宽限期内跨站 POST 仍带 Cookie——补同源校验兜底
    if (contentType && contentType.includes('multipart/form-data')) {
      const host = request.headers.host;
      const origin = request.headers.origin;
      const referer = request.headers.referer;
      const check = (v: string | undefined) => {
        if (!v) return true; // 无来源头（非浏览器客户端）：认证层兜底
        try {
          // vite 代理(5173→3000)/nginx 反代下 origin 端口与请求 host 不一致被误杀；
          // 跨站攻击者 hostname 必然不同，安全语义不变
          const from = new URL(v);
          const hostUrl = new URL(
            host?.includes('://') ? host : `http://${host}`,
          );
          return from.hostname === hostUrl.hostname;
        } catch {
          return false;
        }
      };
      if (!check(origin as string | undefined) || !check(referer as string | undefined)) {
        return false;
      }
    }

    return true;
  }
}
