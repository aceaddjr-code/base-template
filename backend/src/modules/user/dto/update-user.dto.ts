import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsInt, IsArray, Min, MinLength, MaxLength, IsIn, IsNotEmpty } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: '密码至少 3 位' })
  @MaxLength(72)
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
