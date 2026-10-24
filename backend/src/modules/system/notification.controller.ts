import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

@Controller('system/notifications')
export class NotificationController {
  constructor(private readonly notifService: NotificationService) {}

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
}
