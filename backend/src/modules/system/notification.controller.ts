import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { NotificationOutboxService, NOTIFICATION_RETRY_PERMISSION } from './notification-outbox.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@Controller('system/notifications')
export class NotificationController {
  constructor(
    private readonly notifService: NotificationService,
    private readonly outboxService: NotificationOutboxService,
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

  // ===== 第五批：SSE 流与管理端失败补发（system-notifications:retry） =====

  /** SSE 事件流（03 实现）：仅提示 notifications-changed，客户端拉接口取权威结果 */
  @Get('stream')
  stream() {
    // 占位由 03 落地 SSE 实现；保留路由声明避免路由漂移
    return { message: 'SSE 未启用' };
  }

  /** 管理端：投递失败列表（脱敏，不含待投递正文以外的业务内容） */
  @RequirePermission(NOTIFICATION_RETRY_PERMISSION)
  @Get('delivery-failures')
  async deliveryFailures(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.outboxService.failedList(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
  }

  /** 管理端：failed 补发（重新入队；重复点击受租约/唯一键保护） */
  @RequirePermission(NOTIFICATION_RETRY_PERMISSION)
  @Post('delivery-retry')
  async deliveryRetry(@Body() dto: { ids?: number[] }) {
    return this.outboxService.retryFailed(dto?.ids);
  }
}
