import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SystemLogService } from './system-log.service';
import { LogQueryDto } from './dto/log-query.dto';

/** 操作日志查询接口；授权后可查看全站日志。 */
@Controller('system/logs')
@RequirePermission('system-logs:view')
export class SystemLogController {
  constructor(private logService: SystemLogService) {}

  @Get()
  findAll(@Query() query: LogQueryDto) { return this.logService.findAll(query); }
}
