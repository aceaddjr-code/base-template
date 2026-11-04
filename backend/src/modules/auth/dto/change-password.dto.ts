import { IsString, MinLength, MaxLength, IsByteLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(72) @IsByteLength(0, 72, { message: '原密码最多 72 字节' })
  oldPassword: string;

  @IsString() @MinLength(3, { message: '新密码至少 3 位' }) @MaxLength(72) @IsByteLength(0, 72, { message: '新密码最多 72 字节' })
  newPassword: string;

  @IsString() @MinLength(3, { message: '新密码至少 3 位' }) @MaxLength(72) @IsByteLength(0, 72, { message: '确认密码最多 72 字节' })
  confirmPassword: string;
}
