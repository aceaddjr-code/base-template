import {
  BadRequestException, Controller, Delete, Get,
  Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';
import { ATTACHMENT_ALLOWED_EXTS, AttachmentService } from './attachment.service';
import { uploadDestinationFactory, uploadFilenameFactory } from '../../common/uploads/upload.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

function attachmentFileFilter(_req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) {
  if (!ATTACHMENT_ALLOWED_EXTS.includes(extname(file.originalname).toLowerCase())) {
    cb(new BadRequestException('不支持的文件类型'), false);
    return;
  }
  cb(null, true);
}

/** 私有附件（F08）：上传即 temp；下载/删除仅上传者与管理员；业务记录挂接走子表声明式（ADR-0001） */
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // 私有根目录（静态挂载之外）：附件一律经授权接口下载，不提供公开静态 URL
      storage: diskStorage({ destination: uploadDestinationFactory('ATTACHMENT_PRIVATE_DIR', 'uploads-private'), filename: uploadFilenameFactory }),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: attachmentFileFilter,
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: JwtPayload) {
    if (!file?.filename) throw new BadRequestException('请选择文件');
    return this.attachmentService.saveFile(file, user!);
  }

  @Get()
  findPage(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.attachmentService.findPage(Number(page) || 1, Number(pageSize) || 20, status, user!);
  }

  @Get(':id/download')
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
  remove(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return this.attachmentService.remove(Number(id), user!);
  }

  /** 手动触发过期临时附件清理（计划任务每小时同样执行） */
  @Roles('admin')
  @Post('cleanup')
  cleanup() {
    const retention = this.config.get<number>('ATTACHMENT_TEMP_RETENTION_HOURS', 24);
    return this.attachmentService.sweepExpiredTemp(retention);
  }
}
