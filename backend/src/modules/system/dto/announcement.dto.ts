import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1, { message: '标题不能为空' })
  @MaxLength(100)
  title: string;

  @IsString()
  @MinLength(1, { message: '正文不能为空' })
  @MaxLength(5000)
  content: string;
}

export class UpdateAnnouncementDto extends CreateAnnouncementDto {}
