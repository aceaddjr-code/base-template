import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export const HISTORY_ACTIONS = ['create', 'update', 'delete', 'restore', 'view', 'print', 'no_change', 'attachment_upload', 'attachment_delete', 'attachment_restore'];
export class ExampleAccessDto {
  @IsIn(['view', 'print']) action: 'view' | 'print';
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,64}$/) interactionId: string;
  @ValidateIf(o => o.action === 'print' || o.expectedVersion !== undefined)
  @IsInt() @Min(1) @Max(2147483647) expectedVersion?: number;
}
export class ExampleHistoryQuery {
  @IsOptional() @IsIn(HISTORY_ACTIONS) action?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) actorId?: number;
  @IsOptional() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @MaxLength(50) actorName?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) upper?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) eventId?: number;
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
}
export class ExampleFileDto {
  @Type(() => Number) @IsInt() @Min(1) attachmentId: number;
}
