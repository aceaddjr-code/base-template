import {
  BadRequestException, ForbiddenException, Controller, Delete, Get,
  Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { AttachmentService } from './attachment.service';
import { AttachmentUploadInterceptor } from './attachment-upload.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthService } from '../auth/auth.service';
import { attachmentDownloadPermission } from './attachment-access';
import { isSystemAdmin } from '../../common/utils/permission-check';

/** 私有附件（F08）：origin=center 文件库（附件管理自身数据范围），origin=business 业务附件（跟随单据数据范围）；业务记录挂接走子表声明式（ADR-0001） */
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly authService: AuthService,
  ) {}

  /** 附件管理页直传：进入文件库（origin=center，永久保留） */
  @Post()
  @RequirePermission('attachments:upload')
  @UseInterceptors(AttachmentUploadInterceptor)
  upload(@UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: JwtPayload) {
    if (!file?.filename) throw new BadRequestException('请选择文件');
    return this.attachmentService.saveFile(file, user!, 'center');
  }

  @Get()
  @RequirePermission('attachments:view')
  async findPage(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('origin') origin?: string,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('keyword') keyword?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const codes = await this.authService.getUserAccessCodes(user);
    return this.attachmentService.findPage(Number(page) || 1, Number(pageSize) || 20, { origin, status, entityType, keyword }, user!, codes);
  }

  @Get(':id/download')
  @RequirePermission('attachments:view')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user?: JwtPayload,
  ): Promise<void> {
    const row = await this.attachmentService.resolveForDownload(Number(id), user!);
    if (!isSystemAdmin(user)) {
      const required = attachmentDownloadPermission(row.row);
      const codes = await this.authService.getUserAccessCodes(user);
      if (!required || !codes.includes(required)) throw new ForbiddenException('没有下载该文件的权限');
    }
    const download = this.attachmentService.openDownload(row.row);
    res.setHeader('Content-Type', row.row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(row.row.size));
    res.setHeader('Content-Disposition', download.contentDisposition);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try { await pipeline(download.stream, res); } catch { res.destroy(); }
  }

  @Delete(':id')
  @RequirePermission('attachments:delete')
  remove(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return this.attachmentService.remove(Number(id), user!);
  }

  /** 手动触发已删除附件的磁盘文件回收（计划任务每小时同样执行；附件不再按时间清理） */
  @RequirePermission('attachments:cleanup')
  @Post('cleanup')
  cleanup() {
    return this.attachmentService.sweepDeletedFiles();
  }
}
