import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class LogQueryDto {
  @Type(() => Number) @IsInt({ message: '页码必须为整数' }) @Min(1, { message: '页码至少为 1' }) page = 1;
  @Type(() => Number) @IsInt({ message: '每页条数必须为整数' }) @Min(1, { message: '每页至少 1 条' }) @Max(100, { message: '每页最多 100 条' }) pageSize = 20;
  @IsOptional() @IsString({ message: '关键词必须为文本' }) @MaxLength(200, { message: '关键词最多 200 字' }) keyword?: string;
  @IsOptional() @IsString({ message: '操作类型必须为文本' }) @MaxLength(200, { message: '操作类型筛选过长' }) action?: string;
  @IsOptional() @IsString({ message: '模块必须为文本' }) @MaxLength(100, { message: '模块筛选最多 100 字' }) entityType?: string;
  @IsOptional() @IsString({ message: '用户名必须为文本' }) @MaxLength(100, { message: '用户名最多 100 字' }) username?: string;
  @IsOptional() @IsString({ message: '开始日期格式无效' }) @MaxLength(10, { message: '开始日期格式无效' }) dateFrom?: string;
  @IsOptional() @IsString({ message: '结束日期格式无效' }) @MaxLength(10, { message: '结束日期格式无效' }) dateTo?: string;
}
