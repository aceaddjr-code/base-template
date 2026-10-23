import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';

export class CreateMenuDto {
  @IsOptional()
  @IsInt()
  parentId?: number;

  @IsString()
  @IsNotEmpty({ message: '菜单名称不能为空' })
  name: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  permission?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}
