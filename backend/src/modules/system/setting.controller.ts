import {
  Controller, Get, Put,
  Body, Param, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { SettingService } from './setting.service';
import { UpdateSettingDto } from './dto/setting.dto';

/**
 * 系统参数接口
 * 列表与修改：仅 admin（系统管理专用流程）
 * public：登录用户读取公开参数（品牌名、帮助联系方式）
 * 键必须在 setting-registry 预登记，不支持页面创建/删除
 */
@Controller('system/settings')
export class SettingController {
  constructor(private settingService: SettingService) {}

  @Roles('admin')
  @Get()
  listAll() {
    return this.settingService.listAll();
  }

  @Get('public')
  listPublic() {
    return this.settingService.listPublic();
  }

  @Roles('admin')
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @Req() req: Request) {
    return this.settingService.updateValue(key, dto.value, (req as any).user);
  }
}
