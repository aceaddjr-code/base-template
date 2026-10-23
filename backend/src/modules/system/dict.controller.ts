import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { DictService } from './dict.service';
import { CreateDictTypeDto, UpdateDictTypeDto, CreateDictItemDto, UpdateDictItemDto } from './dto/dict.dto';

/**
 * 数据字典接口
 * 查询（按编码）：全员可用（下拉数据源）
 * 管理（类型/选项 CRUD）：仅 admin
 * 注意：/system/dicts/:typeCode 通配路由声明在 types/items 之后（Express 顺序匹配）
 */
@Controller('system/dicts')
export class DictController {
  constructor(private dictService: DictService) {}

  // ===== 管理：类型 =====

  @Roles('admin')
  @Get('types')
  findTypes(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.dictService.findTypes(
      Number.isFinite(p) && p > 0 ? p : 1,
      Number.isFinite(ps) && ps > 0 ? Math.min(ps, 100) : 20,
      keyword,
    );
  }

  @Roles('admin')
  @Post('types')
  createType(@Body() dto: CreateDictTypeDto, @Req() req: Request) {
    return this.dictService.createType(dto, (req as any).user);
  }

  @Roles('admin')
  @Put('types/:id')
  updateType(@Param('id') id: string, @Body() dto: UpdateDictTypeDto, @Req() req: Request) {
    return this.dictService.updateType(parseInt(id, 10), dto, (req as any).user);
  }

  @Roles('admin')
  @Delete('types/:id')
  deleteType(@Param('id') id: string, @Req() req: Request) {
    return this.dictService.deleteType(parseInt(id, 10), (req as any).user);
  }

  // ===== 管理：选项 =====

  @Roles('admin')
  @Get('types/:typeId/items')
  findItems(@Param('typeId') typeId: string) {
    return this.dictService.findItemsByTypeId(parseInt(typeId, 10));
  }

  @Roles('admin')
  @Post('types/:typeId/items')
  createItem(@Param('typeId') typeId: string, @Body() dto: CreateDictItemDto, @Req() req: Request) {
    return this.dictService.createItem(parseInt(typeId, 10), dto, (req as any).user);
  }

  @Roles('admin')
  @Put('items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateDictItemDto, @Req() req: Request) {
    return this.dictService.updateItem(parseInt(id, 10), dto, (req as any).user);
  }

  @Roles('admin')
  @Delete('items/:id')
  deleteItem(@Param('id') id: string, @Req() req: Request) {
    return this.dictService.deleteItem(parseInt(id, 10), (req as any).user);
  }

  // ===== 查询（全员） =====

  /** 含停用项的全量选项：仅供存量历史值的标签回显，不做新增候选 */
  @Get(':typeCode/all')
  findAllByCode(@Param('typeCode') typeCode: string) {
    return this.dictService.getAllItemsByCode(typeCode);
  }

  @Get(':typeCode')
  findByCode(@Param('typeCode') typeCode: string) {
    return this.dictService.findByCode(typeCode);
  }
}
