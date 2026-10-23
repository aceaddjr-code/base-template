import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ensureRequestId, requestContext } from '../utils/request-context';

/**
 * 请求 ID 中间件
 * 每个请求生成唯一 ID，注入到 Response Header 和请求上下文中
 * 方便：
 * 1. 客户端复制 X-Request-ID 来定位问题
 * 2. 日志中按请求 ID 串联追踪
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = ensureRequestId(req, res);
    requestContext.run({ requestId }, next);
  }
}
