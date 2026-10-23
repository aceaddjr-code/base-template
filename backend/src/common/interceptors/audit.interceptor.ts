import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { SystemLogService } from '../../modules/system/system-log.service';
import { serializeAuditDetail } from '../utils/log-sanitizer';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private logService: SystemLogService) {}

  /** 已手动记录审计的路径前缀（防重复） */
  private static readonly MANUAL_LOGGED_PREFIXES = [
    '/api/v1/system/dicts/', // 数据字典
    '/api/v1/system/settings/', // 系统参数（修改时服务层记录含旧值/新值）
    '/api/v1/system/announcements', // 系统公告（含裸 POST 创建路径，服务层记录）
    '/api/v1/auth/', // 登录登出单独处理
    '/api/v1/monitor/frontend-error', // 错误收集不产生另一条业务审计
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const url: string = req.originalUrl || req.url || '';

    // 白名单跳过（手动记录模块）
    if (AuditInterceptor.MANUAL_LOGGED_PREFIXES.some((p) => url.startsWith(p))) {
      return next.handle();
    }

    const action = this.resolveAction(req.method, url);
    if (!action) return next.handle();

    // 仅请求成功（响应正常返回）时记录
    return next.handle().pipe(
      tap({
        next: () => {
          try {
            const user = req.user;
            void this.logService.write({
              userId: user?.sub ?? null,
              username: user?.username ?? null,
              action,
              entityType: this.resolveEntityType(url),
              entityId: this.resolveEntityId(url),
              detail: serializeAuditDetail(req.body),
              ip: req.ip,
            }).catch(() => this.logger.warn(`审计记录失败 requestId=${req.requestId ?? ''}`));
          } catch (e) {
            this.logger.warn(`审计记录失败 requestId=${req.requestId ?? ''}`);
          }
        },
      }),
    );
  }

  /** 方法/路径 → 审计动作：POST=create PUT/PATCH=update DELETE=delete 导出=export 导入=import */
  private resolveAction(method: string, url: string): string | null {
    if (url.includes('/export')) return 'export';
    if (url.includes('/import')) return 'import';
    if (method === 'POST' && /\/batch\/remove(?:\?|$)/.test(url)) return 'delete';
    switch (method) {
      case 'POST':
        return 'create';
      case 'PUT':
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return null;
    }
  }

  /** 路径前两段作为实体类型：/api/v1/examples/items/... → examples_items */
  private resolveEntityType(url: string): string {
    const parts = url.split('?')[0].split('/').filter(Boolean).slice(2, 4); // 去掉 api、v1
    return parts.join('_') || url;
  }

  /** URL 中的首个数字段作为目标记录 ID（如 /items/18/tasks → 18） */
  private resolveEntityId(url: string): number | null {
    const m = url.split('?')[0].match(/\/(\d+)(\/|$)/);
    return m ? parseInt(m[1], 10) : null;
  }

}
