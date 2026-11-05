import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { interval, Subscription } from 'rxjs';
import { NotificationService } from './notification.service';
import { NotificationOutboxService, NOTIFICATION_RETRY_PERMISSION } from './notification-outbox.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SseSessionService } from './sse-session.service';
import type { JwtPayload } from '../auth/jwt.strategy';

/** 连接资源限制（契约 §5 基线；本地测量后记录 acceptance）。 */
export const SSE_PER_USER_LIMIT = 5;
export const SSE_INSTANCE_LIMIT = 200;
/** 心跳与变化检测间隔。 */
const SSE_HEARTBEAT_MS = 15_000;
const SSE_POLL_MS = 3_000;

@Controller('system/notifications')
export class NotificationController {
  /** 实例级/每用户连接计数（本实例限制；跨实例变化靠共享存储轮询）。 */
  private static instanceConnections = 0;
  private static perUserConnections = new Map<number, number>();

  constructor(
    private readonly notifService: NotificationService,
    private readonly outboxService: NotificationOutboxService,
    private readonly sseSession: SseSessionService,
  ) {}

  /** 我的通知分页列表 */
  @Get()
  async list(@Query() query: NotificationQueryDto, @CurrentUser() user: JwtPayload) {
    return this.notifService.findMine(user.sub, query.page, query.pageSize, query.readStatus);
  }

  /** 未读数 */
  @Get('unread-count')
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.notifService.unreadCount(user.sub);
    return { count };
  }

  /** 标已读 */
  @Post(':id/read')
  async markRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    await this.notifService.markRead(user.sub, id);
    return { success: true };
  }

  /** 全部已读 */
  @Post('read-all')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    await this.notifService.markAllRead(user.sub);
    return { success: true };
  }

  /**
   * SSE 事件流（第五批 03）：同源 Cookie 鉴权（不走 URL Token）；仅推送 notifications-changed
   * 提示（版本=该用户通知 max id:未读数），客户端拉接口取权威结果、不本地 +1。
   * 连接建立与每次推送/心跳前复核账号状态、tokenVersion 与第一批待改密门禁；失效即关闭。
   * 不做事件重放：断线由持久列表兜底；代理环境响应携带 X-Accel-Buffering:no。
   */
  @Get('stream')
  async stream(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const connections = NotificationController.perUserConnections.get(user.sub) ?? 0;
    if (connections >= SSE_PER_USER_LIMIT || NotificationController.instanceConnections >= SSE_INSTANCE_LIMIT) {
      res.status(HttpStatus.FORBIDDEN).json({ code: 403, message: '通知连接数已达上限，请关闭其他标签页后重试', data: null });
      return;
    }
    NotificationController.instanceConnections += 1;
    NotificationController.perUserConnections.set(user.sub, connections + 1);

    res.status(200).setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    // 反向代理（nginx 等）禁用响应缓冲，事件直发；部署清单见任务文档
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    res.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

    let lastVersion = await this.outboxService.userVersion(user.sub);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      NotificationController.instanceConnections -= 1;
      const current = (NotificationController.perUserConnections.get(user.sub) ?? 1) - 1;
      if (current > 0) NotificationController.perUserConnections.set(user.sub, current);
      else NotificationController.perUserConnections.delete(user.sub);
      for (const sub of subscriptions) sub.unsubscribe();
      res.end();
    };
    res.on('close', close);

    const checkAndPush = async (heartbeat: boolean) => {
      if (closed) return;
      try {
        // 每次推送/心跳前复核：账号状态、tokenVersion、待改密（第一批门禁）
        const session = await this.sseSession.revalidate(user);
        if (!session.valid) {
          res.write(`event: session-expired\ndata: ${JSON.stringify({ reason: session.reason })}\n\n`);
          close();
          return;
        }
        const version = await this.outboxService.userVersion(user.sub);
        if (version !== lastVersion) {
          lastVersion = version;
          res.write(`event: notifications-changed\ndata: ${JSON.stringify({ version, at: new Date().toISOString() })}\n\n`);
        } else if (heartbeat) {
          res.write(`: heartbeat ${Date.now()}\n\n`);
        }
      } catch {
        // 存储故障：心跳保活；持续故障由客户端重连/降级兜底
        if (heartbeat) res.write(`: heartbeat ${Date.now()}\n\n`);
      }
    };

    const subscriptions: Subscription[] = [
      interval(SSE_POLL_MS).subscribe(() => { void checkAndPush(false); }),
      interval(SSE_HEARTBEAT_MS).subscribe(() => { void checkAndPush(true); }),
    ];
  }

  /** 管理端：投递失败列表（脱敏） */
  @RequirePermission(NOTIFICATION_RETRY_PERMISSION)
  @Get('delivery-failures')
  async deliveryFailures(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.outboxService.failedList(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
  }

  /** 管理端：failed 补发 */
  @RequirePermission(NOTIFICATION_RETRY_PERMISSION)
  @Post('delivery-retry')
  async deliveryRetry(@Body() dto: { ids?: number[] }) {
    return this.outboxService.retryFailed(dto?.ids);
  }
}
