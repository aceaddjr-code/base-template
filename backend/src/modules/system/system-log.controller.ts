import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemLogService } from './system-log.service';
import { LogQueryDto } from './dto/log-query.dto';

/** 操作日志查询接口（仅 admin） */
@Controller('system/logs')
@Roles('admin')
export class SystemLogController {
  constructor(private logService: SystemLogService) {}

  @Get()
  findAll(@Query() query: LogQueryDto) { return this.logService.findAll(query); }
}
