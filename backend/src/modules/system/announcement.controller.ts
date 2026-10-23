import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcement.dto';

/**
 * 系统公告接口
 * 管理（草稿/发布/撤回/删除）：仅 admin，审计由服务层记录
 * 阅读（已发布列表与详情）：登录用户；非公开状态详情仅 admin
 * 注意：/published 固定路由必须声明在 /:id 之前（Express 顺序匹配）
 */
@Controller('system/announcements')
export class AnnouncementController {
  constructor(private announcementService: AnnouncementService) {}

  // ===== 阅读（登录用户） =====

  @Get('published')
  findPublished(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.announcementService.findPublishedPage(parseInt(page || '1', 10) || 1, parseInt(pageSize || '10', 10) || 10);
  }

  @Get(':id')
  readDetail(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    const isAdmin = user?.roleCode === 'admin' || (Array.isArray(user?.roles) && user.roles.includes('admin'));
    return this.announcementService.readDetail(Number(id), isAdmin);
  }

  // ===== 管理（admin） =====

  @Roles('admin')
  @Get()
  findPage(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string, @Query('keyword') keyword?: string) {
    return this.announcementService.findPage(parseInt(page || '1', 10) || 1, parseInt(pageSize || '20', 10) || 20, status, keyword);
  }

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @Req() req: Request) {
    return this.announcementService.create(dto, (req as any).user);
  }

  @Roles('admin')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @Req() req: Request) {
    return this.announcementService.update(parseInt(id, 10), dto, (req as any).user);
  }

  @Roles('admin')
  @Post(':id/publish')
  publish(@Param('id') id: string, @Req() req: Request) {
    return this.announcementService.publish(parseInt(id, 10), (req as any).user);
  }

  @Roles('admin')
  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Req() req: Request) {
    return this.announcementService.withdraw(parseInt(id, 10), (req as any).user);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.announcementService.remove(parseInt(id, 10), (req as any).user);
  }
}
