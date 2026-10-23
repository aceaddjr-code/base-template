import { IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(72)
  oldPassword: string;

  @IsString() @MinLength(3, { message: '新密码至少 3 位' }) @MaxLength(72)
  newPassword: string;

  @IsString() @MinLength(3) @MaxLength(72)
  confirmPassword: string;
}
