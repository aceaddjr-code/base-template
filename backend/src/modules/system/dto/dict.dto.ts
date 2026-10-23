import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** 字典类型：新增 */
export class CreateDictTypeDto {
  @IsString()
  @MaxLength(50)
  code: string;

  @IsString()
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

/** 字典类型：编辑 */
export class UpdateDictTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

/** 字典选项：新增 */
export class CreateDictItemDto {
  @IsString()
  @MaxLength(50)
  label: string;

  @IsString()
  @MaxLength(50)
  value: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

/** 字典选项：编辑 */
export class UpdateDictItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
