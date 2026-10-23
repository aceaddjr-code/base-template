import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, UploadedFile, UseInterceptors, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CrudBaseService } from '../services/crud-base.service';
import { getUserId } from '../utils/service-helpers';
import { excelFileFilter, sendExcel } from '../utils/excel-helper';
import { buildListQuery } from '../utils/list-query';

/**
 * 通用 CRUD 控制器基类
 *
 * 各模块控制器继承后：
 * - @Controller('xxx/yyy') 指定路由
 * - super(service) 注入对应 service
 *
 * 统一路由：
 * - GET    /             分页列表（?page&pageSize&keyword&status=...）
 * - GET    /:id          详情（含子表）
 * - POST   /             创建（含子表）
 * - PUT    /:id          更新（子表全量替换）
 * - DELETE /:id          删除（软删除）
 */
export abstract class CrudBaseController {
  constructor(protected readonly service: CrudBaseService<any>) {}

  @Get()
  async list(@Req() req?: Request) {
    return this.service.list(buildListQuery(req), req?.user as any);
  }

  /** 与列表同一筛选和数据范围；导出当前可见列或选中记录。 */
  @Get('export')
  async exportExcel(@Req() req: Request, @Res() res: Response) {
    const { buffer, filename } = await this.service.exportExcel(req?.user as any, buildListQuery(req));
    sendExcel(res, buffer, filename);
  }

  @Get('distinct')
  async distinctValues(@Query('field') field: string, @Req() req: Request) {
    if (!field) return [];
    return this.service.distinctValues(field, req?.user as any);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.findOne(id, req?.user as any);
  }

  @Post()
  async create(@Body() dto: any, @Req() req: Request) {
    return this.service.create(dto, getUserId(req.user) ?? undefined, req.user as any);
  }

  /** 导入 Excel（与 @Post() 路径不同，无顺序冲突） */
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: excelFileFilter }))
  async importExcel(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    return this.service.importFromExcel(file.buffer, getUserId(req.user) ?? undefined, req.user as any);
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @Req() req: Request) {
    return this.service.update(id, dto, getUserId(req.user) ?? undefined, req.user as any);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.remove(id, req?.user as any);
  }
}
