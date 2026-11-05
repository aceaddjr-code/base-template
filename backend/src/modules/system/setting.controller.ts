import {
  Controller, Get, Put,
  Body, Param, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SettingService } from './setting.service';
import { UpdateSettingDto, UpdateSettingsBatchDto } from './dto/setting.dto';

/**
 * 系统参数接口
 * 列表与修改：admin（类级）＋ system-settings:update 权限码（第六批；admin 例外保留）
 * public：登录用户读取公开参数（品牌名、帮助联系方式、维护通知）
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

  /** 原子批量更新（第六批）：路由先于 :key；重复键/未知键/非法值/组合校验拒绝；baseRevision 冲突 409 */
  @RequirePermission('system-settings:update')
  @Put('batch')
  updateBatch(@Body() dto: UpdateSettingsBatchDto, @Req() req: Request) {
    return this.settingService.updateBatch(dto.items, (req as any).user, dto.baseRevision);
  }

  /** 单键更新：复用批量同一校验/事务/修订号语义（不可绕过组合约束） */
  @RequirePermission('system-settings:update')
  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @Req() req: Request) {
    return this.settingService.updateValue(key, dto.value, (req as any).user, dto.baseRevision);
  }
}
