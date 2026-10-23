import {
  BadRequestException, Body, Controller, Delete, Get,
  Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { IsInt, IsString, MaxLength } from 'class-validator';
import { AttachmentService } from './attachment.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';

const ATTACHMENT_EXTS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.txt', '.csv', '.md',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
];

/** 私有目录（静态挂载之外）：附件一律经授权接口下载，不提供公开静态 URL */
function privateDestinationFactory() {
  return (_req: any, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
    const dir = resolve(
      process.cwd(),
      process.env.ATTACHMENT_PRIVATE_DIR ?? 'uploads-private',
      `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    );
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  };
}

function attachmentFileFilter(_req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) {
  if (!ATTACHMENT_EXTS.includes(extname(file.originalname).toLowerCase())) {
    cb(new BadRequestException('不支持的文件类型'), false);
    return;
  }
  cb(null, true);
}

function attachmentFilenameFactory(_req: any, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) {
  cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname).toLowerCase()}`);
}

class BindAttachmentDto {
  @IsString()
  @MaxLength(50)
  entityType: string;

  @IsInt()
  entityId: number;
}

/** 私有附件（F08）：上传即 temp；下载/删除按上传者与注册表裁决；bind 需登记的目标类型 */
@Controller('attachments')
export class AttachmentController {
  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({ destination: privateDestinationFactory(), filename: attachmentFilenameFactory }),
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

  @Post(':id/bind')
  bind(
    @Param('id') id: string,
    @Body() dto: { entityType: string; entityId: number },
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.attachmentService.bind(Number(id), dto.entityType, Number(dto.entityId), user!);
  }

  @Post(':id/unbind')
  unbind(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return this.attachmentService.unbind(Number(id), user!);
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
