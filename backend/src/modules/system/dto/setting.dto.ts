import { IsArray, IsInt, IsOptional, IsString, MaxLength, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  @MaxLength(500)
  value: string;

  /** 乐观并发基准（第六批）：与当前全局修订号比对，不匹配 409。必须携带。 */
  @IsInt()
  baseRevision: number;
}

export class SettingsBatchItemDto {
  @IsString()
  key: string;

  @IsString()
  @MaxLength(500)
  value: string;
}

export class UpdateSettingsBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  items: SettingsBatchItemDto[];

  @IsInt()
  baseRevision: number;
}
