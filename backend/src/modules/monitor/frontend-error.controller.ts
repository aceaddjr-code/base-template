import { Body, Controller, Logger, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, Max, Matches, ValidateNested } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitizer';
import { requestContext } from '../../common/utils/request-context';

export class FrontendErrorEventDto {
  @IsString() @MaxLength(50) type: string;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
  @IsOptional() @IsString() @MaxLength(5000) stack?: string;
  @IsOptional() @IsString() @MaxLength(1000) page?: string;
  @IsOptional() @IsString() @MaxLength(1000) ua?: string;
  @IsOptional() @IsString() @MaxLength(50) ts?: string;
  @IsOptional() @IsInt() @Min(100) @Max(599) status?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) url?: string;
  @IsOptional() @IsString() @MaxLength(20) method?: string;
  @IsOptional() @IsString() @MaxLength(1000) file?: string;
  @IsOptional() @IsInt() @Min(0) line?: number;
  @IsOptional() @IsInt() @Min(0) col?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/) requestId?: string;
}

export class FrontendErrorBatchDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FrontendErrorEventDto)
  events: FrontendErrorEventDto[];
}

@Controller('monitor/frontend-error')
export class FrontendErrorController {
  private readonly logger = new Logger('FrontendError');

  @Public()
  @Post()
  report(@Body() dto: FrontendErrorBatchDto) {
    const events = Array.isArray(dto?.events) ? dto.events : [];
    for (const ev of events) {
      // 单行 JSON 防止注入伪造日志；上报请求号与原故障请求号分别保留。
      this.logger.error(JSON.stringify({ ...sanitizeLogValue(ev) as object, reportRequestId: requestContext.getStore()?.requestId }));
    }
    return { code: 200, message: 'ok', received: events.length };
  }
}
