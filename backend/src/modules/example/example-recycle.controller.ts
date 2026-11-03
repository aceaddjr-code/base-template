import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ExampleRecycleService } from './example-recycle.service';
import { JwtPayload } from '../auth/jwt.strategy';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SkipRequestAudit } from '../../common/decorators/skip-request-audit.decorator';
import { AttachmentRecycleService } from './attachment-recycle.service';

class RecycleBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsInt({ each: true }) @Min(1, { each: true }) ids: number[];
  @IsIn(['restore', 'purge']) action: 'restore' | 'purge';
}
class RecycleQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(100) keyword = '';
  @IsOptional() @IsIn(['example-items']) module?: string;
}

/** 空权限集合表示对全部已登录账号开放，数据范围在服务层逐次裁决。 */
@Controller('recycle-bin')
@RequirePermission()
@SkipRequestAudit()
export class ExampleRecycleController {
  constructor(private readonly service: ExampleRecycleService, private readonly files: AttachmentRecycleService) {}
  @Get()
  list(@Req() req: Request, @Query() query: RecycleQueryDto) {
    return this.service.list(req.user as JwtPayload, query.page, query.pageSize, query.keyword, query.module);
  }
  @Post('batch')
  batch(@Body() dto: RecycleBatchDto, @Req() req: Request) { return this.service.batch(dto.ids, dto.action, req.user as JwtPayload); }
  @Get('files')
  fileList(@Req() req: Request, @Query() query: RecycleQueryDto) { return this.files.list(req.user as JwtPayload, query.page, query.pageSize, query.keyword); }
  @Post('files/batch')
  fileBatch(@Body() dto: RecycleBatchDto, @Req() req: Request) { return this.files.batch(dto.ids, dto.action, req.user as JwtPayload); }
  @Get('files/:id')
  fileDetail(@Param('id', ParseIntPipe) id: number, @Req() req: Request) { return this.files.detail(id, req.user as JwtPayload); }
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: Request) { return this.service.detail(id, req.user as JwtPayload); }
  @Get(':id/attachments/:fileId/download')
  async file(@Param('id', ParseIntPipe) id: number, @Param('fileId', ParseIntPipe) fileId: number, @Req() req: Request, @Res() res: Response) {
    const file = await this.service.file(id, fileId, req.user as JwtPayload);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', file.contentDisposition);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try { await pipeline(file.stream, res); } catch { res.destroy(); }
  }
}
