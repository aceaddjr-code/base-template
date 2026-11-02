import {
  BadRequestException, Controller, Delete, Get,
  Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentService } from './attachment.service';
import { AttachmentUploadInterceptor } from './attachment-upload.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

/** 私有附件（F08）：origin=center 文件库（附件管理自身数据范围），origin=business 业务附件（跟随单据数据范围）；业务记录挂接走子表声明式（ADR-0001） */
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
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
  findPage(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('origin') origin?: string,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('keyword') keyword?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.attachmentService.findPage(Number(page) || 1, Number(pageSize) || 20, { origin, status, entityType, keyword }, user!);
  }

  @Get(':id/download')
  @RequirePermission('attachments:download')
  async download(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user?: JwtPayload,
  ): Promise<void> {
    const row = await this.attachmentService.resolveForDownload(Number(id), user!);
    const download = this.attachmentService.openDownload(row.row);
    res.setHeader('Content-Type', row.row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(row.row.size));
    res.setHeader('Content-Disposition', download.contentDisposition);
    download.stream.pipe(res);
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
