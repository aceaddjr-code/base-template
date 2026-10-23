import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { CrudBaseController } from '../../common/controllers/crud-base.controller';
import { CrudPermPrefix } from '../../common/decorators/crud-perm-prefix.decorator';
import { ExampleService } from './example.service';
import { BatchRemoveExampleDto, CreateExampleDto, UpdateExampleDto } from './example.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { excelFileFilter, sendExcel } from '../../common/utils/excel-helper';
import type { Request, Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { getUserId } from '../../common/utils/service-helpers';

@CrudPermPrefix('example-items')
@Controller('examples/items')
export class ExampleController extends CrudBaseController {
  constructor(protected readonly service: ExampleService) {
    super(service);
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
    return this.service.batchRemove(dto.ids, req.user as any);
  }

  @Post()
  override create(@Body() dto: CreateExampleDto, @Req() req: Request) {
    return super.create(dto, req);
  }

  @Put(':id')
  override update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExampleDto, @Req() req: Request) {
    return super.update(id, dto, req);
  }
}
