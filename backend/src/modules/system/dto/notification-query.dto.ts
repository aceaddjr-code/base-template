import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export class NotificationQueryDto {
  @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 10;

  @IsIn(['all', 'unread'])
  readStatus: 'all' | 'unread' = 'all';
}
