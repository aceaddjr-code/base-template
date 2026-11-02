import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { CrudBaseController } from '../../common/controllers/crud-base.controller';
import { CrudPermPrefix } from '../../common/decorators/crud-perm-prefix.decorator';
import { ExampleService } from './example.service';
import { BatchRemoveExampleDto, CreateExampleDto, UpdateExampleDto } from './example.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { excelFileFilter, sendExcel } from '../../common/utils/excel-helper';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getUserId } from '../../common/utils/service-helpers';
import { ExampleAccessDto, ExampleHistoryQuery, ExampleFileDto } from './example-history.dto';
import { pipeline } from 'node:stream/promises';
import { ATTACHMENT_IMAGE_MIMES, ATTACHMENT_PREVIEW_IMAGE_EXTS } from '../attachment/attachment.service';
import { extname } from 'node:path';
import { SkipRequestAudit } from '../../common/decorators/skip-request-audit.decorator';
import { AttachmentUploadInterceptor } from '../attachment/attachment-upload.interceptor';

@CrudPermPrefix('example-items')
@Controller('examples/items')
export class ExampleController extends CrudBaseController {
  constructor(protected readonly service: ExampleService) {
    super(service);
  }

  /** 单据的临时文件上传跟随单据编辑权限；挂接时另行校验记录的数据范围。 */
  @Post('attachments/upload')
  @RequirePermission('example-items:update')
  @UseInterceptors(AttachmentUploadInterceptor)
  uploadAttachment(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file?.filename) throw new BadRequestException('请选择文件');
    return this.service.uploadAttachment(file, req.user as any);
  }

  @Get(':id/attachments')
  @RequirePermission('example-items:view')
  files(@Param('id', ParseIntPipe) id: number, @Req() req: Request) { return this.service.files(id, req.user as any); }

  @Post(':id/attachments')
  @RequirePermission('example-items:update')
  addFile(@Param('id', ParseIntPipe) id: number, @Body() dto: ExampleFileDto, @Req() req: Request) { return this.service.addFile(id, dto.attachmentId, req.user as any); }

  @Delete(':id/attachments/:fileId')
  @RequirePermission('example-items:update')
  removeFile(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number, @Req() req: Request) { return this.service.removeFile(id, fileId, req.user as any); }

  @Get(':id/attachments/:fileId/download')
  @RequirePermission('example-items:view')
  async downloadFile(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number, @Req() req: Request, @Res() res: Response) {
    const file = await this.service.file(id, fileId, req.user as any);
    const imageMime = ATTACHMENT_IMAGE_MIMES[extname(file.row.originalName).toLowerCase()];
    res.setHeader('Content-Type', imageMime || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', req.query.preview === '1' && ATTACHMENT_PREVIEW_IMAGE_EXTS.has(extname(file.row.originalName).toLowerCase()) ? 'inline' : file.contentDisposition);
    try { await pipeline(file.stream, res); } catch { res.destroy(); }
  }

  @Post(':id/access-events')
  @SkipRequestAudit()
  @RequirePermission('example-items:view')
  accessEvent(@Param('id', ParseIntPipe) id: number, @Body() dto: ExampleAccessDto, @Req() req: Request) {
    return this.service.accessEvent(id, dto, req.user as any, req['requestId']);
  }

  @Get(':id/activity')
  @RequirePermission('example-items:view')
  activity(@Param('id', ParseIntPipe) id: number, @Query() query: ExampleHistoryQuery, @Req() req: Request) {
    return this.service.history(id, 'activity', query, req.user as any);
  }

  @Get(':id/operations')
  @RequirePermission('example-items:view')
  operations(@Param('id', ParseIntPipe) id: number, @Query() query: ExampleHistoryQuery, @Req() req: Request) {
    return this.service.history(id, 'operations', query, req.user as any);
  }

  @Get(':id/changes')
  @RequirePermission('example-items:view')
  changes(@Param('id', ParseIntPipe) id: number, @Query() query: ExampleHistoryQuery, @Req() req: Request) {
    return this.service.history(id, 'changes', query, req.user as any);
  }

  /** 预检（F30）：逐行走导入同套规则,不写任何数据;确认导入时服务端会重新验证 */
  @Post('import/precheck')
  @RequirePermission('example-items:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: excelFileFilter }))
  async importPrecheck(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    return this.service.importPreview(file.buffer, getUserId(req.user) ?? undefined, req.user as any);
  }

  /** 导入模板（F30）：仅表头,与导入列一致 */
  @Get('import/template')
  @RequirePermission('example-items:import')
  async importTemplate(@Res() res: Response): Promise<void> {
    sendExcel(res, await this.service.importTemplateBuffer(), '示例事项导入模板.xlsx');
  }

  @Post('batch/remove')
  @RequirePermission('example-items:delete')
  batchRemove(@Body() dto: BatchRemoveExampleDto, @Req() req: Request) {
    return this.service.batchRemove(dto.ids, req.user as any, req['requestId']);
  }

  @Post()
  override create(@Body() dto: CreateExampleDto, @Req() req: Request) {
    return this.service.create(dto, getUserId(req.user) ?? undefined, req.user as any, { requestId: req['requestId'] });
  }

  @Put(':id')
  override update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExampleDto, @Req() req: Request) {
    return this.service.update(id, dto, getUserId(req.user) ?? undefined, req.user as any, { requestId: req['requestId'] });
  }

  @Delete(':id')
  override remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.remove(id, req.user as any, { requestId: req['requestId'] });
  }
}
