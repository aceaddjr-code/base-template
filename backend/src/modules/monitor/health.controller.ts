import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * 健康检查探针（F15）：存活与就绪分离。
 * /health/live 供编排器判活；/health/ready 在数据库不可达时返回 503 供摘除流量；
 * GET /health 保留信息聚合视图（兼容原响应结构），流量判定以 /health/ready 为准。
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('live')
  live() {
    return this.healthService.live();
  }

  @Public()
  @Get('ready')
  ready() {
    return this.healthService.ready();
  }

  @Public()
  @Get()
  aggregate() {
    return this.healthService.aggregate();
  }
}
