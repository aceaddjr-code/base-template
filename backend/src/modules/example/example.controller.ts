import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { CrudBaseController } from '../../common/controllers/crud-base.controller';
import { CrudPermPrefix } from '../../common/decorators/crud-perm-prefix.decorator';
import { ExampleService } from './example.service';
import { ExampleImportService } from './example-import.service';
import { BatchRemoveExampleDto, ChangeExampleOwnerDto, CreateExampleDto, UpdateExampleDto } from './example.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { excelFileFilter, sendExcel, errorFileToExcel, reportToExcel } from '../../common/utils/excel-helper';
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
  constructor(
    protected readonly service: ExampleService,
    private readonly importService: ExampleImportService,
  ) {
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

  /** 变更单据负责人：独立权限码，角色管理可配置；admin 天生旁路。 */
  @Post(':id/owner')
  @RequirePermission('example-items:owner')
  changeOwner(@Param('id', ParseIntPipe) id: number, @Body() dto: ChangeExampleOwnerDto, @Req() req: Request) {
    return this.service.changeOwner(id, dto.ownerId, req.user as any, { requestId: req['requestId'] });
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

  /** 旧确认导入（无会话/无幂等）已收敛：拒绝并指向新路径（第四批契约 §3）。 */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: excelFileFilter }))
  override async importExcel(@UploadedFile() file: Express.Multer.File): Promise<never> {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    throw new BadRequestException('导入已升级为会话模式：请先调用 import/precheck，再用 importId 调用 import/confirm');
  }

  /**
   * 预检（第四批会话化）：解析→逐行校验（不写业务记录）→创建/复用导入会话。
   * 同文件已有 pending 会话直接返回（duplicateOf 提示）；?newBatch=1 显式新批次（将重复创建已成功记录）。
   */
  @Post('import/precheck')
  @RequirePermission('example-items:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: excelFileFilter }))
  async importPrecheck(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    const user = req.user as any;
    return this.importService.precheck(file.buffer, file.originalname, user.sub, {
      parse: buffer => this.service.parseImportWithMeta(buffer),
      validateRow: row => this.service.validateImportRowPublic(row),
      prepareRows: rows => this.service.prepareImportRowsForSession(rows),
    }, req.query.newBatch === '1');
  }

  /** 确认导入（第四批）：只按服务端保存的预检行写入；幂等——重复确认/响应丢失重试不重复建单。 */
  @Post('import/confirm')
  @RequirePermission('example-items:import')
  async importConfirm(@Body() dto: { importId: string }, @Req() req: Request) {
    if (!dto?.importId || typeof dto.importId !== 'string') throw new BadRequestException('缺少 importId');
    const user = req.user as any;
    return this.importService.confirm(dto.importId, user.sub, (manager, row) => this.service.importRowWithinTx(manager, row, user, dto.importId));
  }

  /** 会话状态/结果查询（第四批）：仅本人；刷新可恢复。 */
  @Get('import/:importId')
  @RequirePermission('example-items:import')
  async importStatus(@Param('importId') importId: string, @Req() req: Request) {
    return this.importService.status(importId, (req.user as any).sub);
  }

  /** 完整核对报告（第四批 03）：全行状态/原始行号/原因/成功编号；仅供核对，不可作导入模板。 */
  @SkipRequestAudit()
  @RequirePermission('example-items:import')
  @Get('import/:importId/report')
  async importReport(@Param('importId') importId: string, @Req() req: Request, @Res() res: Response) {
    const { rows } = await this.importService.rowsForFile(importId, (req.user as any).sub, false);
    const buffer = await reportToExcel(rows.map(row => ({
      rowNumber: row.rowNumber,
      status: row.status,
      error: row.errorMessage,
      createdDocNo: row.createdDocNo,
      title: row.data?.title ?? null,
    })));
    sendExcel(res, buffer, `导入核对报告-${importId.slice(0, 8)}.xlsx`);
  }

  /** 修正文件（第四批 03）：仅未成功行，标准导入列＋标红错误单元格＋原因列；重新预检形成新会话。 */
  @SkipRequestAudit()
  @RequirePermission('example-items:import')
  @Get('import/:importId/error-file')
  async importErrorFile(@Param('importId') importId: string, @Req() req: Request, @Res() res: Response) {
    const { rows } = await this.importService.rowsForFile(importId, (req.user as any).sub, true);
    if (!rows.length) throw new BadRequestException('没有失败或未处理的行，无需下载修正文件');
    const headers = (this.service.importColumns ?? []).map(column => ({ header: column.header, key: column.key, width: column.width }));
    const buffer = await errorFileToExcel(
      rows.map(row => ({
        values: row.data ?? {},
        errors: row.cellRefs
          ? Object.fromEntries(Object.keys(row.cellRefs).map(key => {
              const related = row.errorMessage && /标题|状态|类别/.test(row.errorMessage) && key === 'title' ? row.errorMessage : null;
              return [key, related ?? (row.status === 'invalid' ? row.errorMessage : '')];
            }).filter(([, v]) => !!v))
          : (row.status === 'invalid' && row.errorMessage ? { title: row.errorMessage } : {}),
        meta: { rowNumber: row.rowNumber },
      })),
      headers,
      { errorColumnHeader: '错误原因', metaColumns: [{ header: '原始行号', key: 'rowNumber' }] },
    );
    sendExcel(res, buffer, `导入修正文件-${importId.slice(0, 8)}.xlsx`);
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
