import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { HealthService } from './health.service';

/**
 * 管理端维护诊断（F15）：仅 admin 可读。
 * 输出只含运行状态与可用性（版本/内存/数据库连通与延迟/附件目录可写），
 * 不含密钥、连接串与绝对路径。
 */
@Controller('monitor/diagnostics')
export class DiagnosticsController {
  constructor(private readonly healthService: HealthService) {}

  @Roles('admin')
  @Get()
  diagnostics() {
    return this.healthService.diagnostics();
  }
}
