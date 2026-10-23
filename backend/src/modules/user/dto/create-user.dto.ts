import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsArray, Min, MinLength, MaxLength, IsEmail, IsByteLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: '登录账号必须为文本' })
  @IsNotEmpty({ message: '请输入登录账号' })
  @MaxLength(50, { message: '登录账号不能超过 50 字' })
  loginid: string;

  @IsString()
  @MinLength(3, { message: '密码至少 3 位' })
  @MaxLength(72, { message: '密码不能超过 72 字' })
  @IsByteLength(0, 72, { message: '密码最多 72 字节' })
  password: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty({ message: '请填写姓名' })
  @MaxLength(50, { message: '姓名不能超过 50 字' })
  displayName: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((_, value) => value !== '')
  @IsEmail({}, { message: '请输入有效的邮箱地址' })
  @IsString()
  @MaxLength(100, { message: '邮箱不能超过 100 字' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '手机号不能超过 20 字' })
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  roleId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  deptId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  leaderId?: number | null;
}
