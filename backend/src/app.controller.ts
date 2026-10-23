import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/decorators/public.decorator';

@SkipThrottle()
@Controller()
export class AppController {
  /** 根路径简单健康检查（不暴露框架信息，公开访问）；存活/就绪探针见 monitor/health */
  @Public()
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}
