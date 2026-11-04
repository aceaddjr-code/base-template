import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsInt, IsArray, Min, MaxLength, IsIn, IsNotEmpty } from 'class-validator';

export class UpdateUserDto {
  /** 兼容字段：普通编辑不能改密码，非空一律被服务层拒绝并指向「重置密码」。 */
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roleId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each:true })
  @Min(1, { each:true })
  roleIds?: number[];

  @IsOptional()
  @IsInt()
  @IsIn([0,1])
  status?: number;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  deptId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  leaderId?: number | null;
}
