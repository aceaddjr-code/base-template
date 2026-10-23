import { Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto/notification-query.dto';

@Controller('system/notifications')
export class NotificationController {
  constructor(private readonly notifService: NotificationService) {}

  /** 我的通知分页列表 */
  @Get()
  async list(@Query() query: NotificationQueryDto, @Req() req?: any) {
    const uid = req?.user?.sub ?? 0;
    return this.notifService.findMine(uid, query.page, query.pageSize, query.readStatus);
  }

  /** 未读数 */
  @Get('unread-count')
  async unreadCount(@Req() req?: any) {
    const count = await this.notifService.unreadCount(req?.user?.sub ?? 0);
    return { count };
  }

  /** 标已读 */
  @Post(':id/read')
  async markRead(@Param('id', ParseIntPipe) id: number, @Req() req?: any) {
    await this.notifService.markRead(req?.user?.sub ?? 0, id);
    return { success: true };
  }

  /** 全部已读 */
  @Post('read-all')
  async markAllRead(@Req() req?: any) {
    await this.notifService.markAllRead(req?.user?.sub ?? 0);
    return { success: true };
  }
}
