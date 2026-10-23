import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysSetting } from './entities/sys-setting.entity';
import { SETTING_REGISTRY, SettingDefinition, findSettingDefinition } from './setting-registry';
import { getUserId } from '../../common/utils/service-helpers';
import { SystemLogService } from './system-log.service';

export interface SettingView {
  key: string;
  name: string;
  type: 'string' | 'text';
  public: boolean;
  description: string;
  maxLength: number;
  value: string;
  defaultValue: string;
  modified: boolean;
  updatedAt: string | Date | null;
}

@Injectable()
export class SettingService {
  constructor(
    @InjectRepository(SysSetting) private readonly settingRepo: Repository<SysSetting>,
    private readonly logService: SystemLogService,
  ) {}

  /** 注册表顺序输出全部参数；未修改过的键返回默认值 */
  async listAll(): Promise<SettingView[]> {
    const rows = await this.settingRepo.find();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return SETTING_REGISTRY.map((def) => this.toView(def, byKey.get(def.key)));
  }

  /** 登录用户可读的公开参数（key → 当前取值），未设置的键返回默认值 */
  async listPublic(): Promise<Record<string, string>> {
    const rows = await this.settingRepo.find();
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const result: Record<string, string> = {};
    for (const def of SETTING_REGISTRY) {
      if (def.public) result[def.key] = byKey.get(def.key) ?? def.defaultValue;
    }
    return result;
  }

  async updateValue(key: string, rawValue: string, user?: any): Promise<SettingView> {
    const def = findSettingDefinition(key);
    if (!def) throw new NotFoundException('参数不存在或未登记');
    const value = this.normalize(def, rawValue);
    const old = await this.settingRepo.findOne({ where: { key } });
    let row: SysSetting;
    if (old) {
      await this.settingRepo.update(old.id, { value, updatedBy: getUserId(user) });
      row = { ...old, value, updatedBy: getUserId(user) } as SysSetting;
    } else {
      row = await this.settingRepo.save({ key, value, createdBy: getUserId(user), updatedBy: getUserId(user) });
    }
    await this.logService.write({
      userId: getUserId(user), username: user?.username, action: 'update',
      entityType: 'system_settings', entityId: row.id, entityDesc: key,
      detail: JSON.stringify({ ...(old ? { old: { value: old.value } } : {}), new: { value } }),
    });
    return this.toView(def, row);
  }

  /** 按注册表类型校验/规范化取值；业务校验失败带 value 字段路径，供表单映射 */
  private normalize(def: SettingDefinition, rawValue: string): string {
    if (typeof rawValue !== 'string') throw this.invalidValue(def, 'invalid', '参数值必须是字符串');
    const value = def.type === 'text' ? rawValue.replace(/\r\n/g, '\n').trim() : rawValue.trim();
    if (value.length > def.maxLength) throw this.invalidValue(def, 'maxlength', `${def.name}最多 ${def.maxLength} 个字符`);
    if (def.required && !value) throw this.invalidValue(def, 'required', `${def.name}不能为空`);
    return value;
  }

  private invalidValue(def: SettingDefinition, code: string, message: string) {
    return new BadRequestException({ message, fieldErrors: [{ path: 'value', code, message }] });
  }

  private toView(def: SettingDefinition, row?: SysSetting | null): SettingView {
    const modified = !!row;
    return {
      key: def.key,
      name: def.name,
      type: def.type,
      public: def.public,
      description: def.description,
      maxLength: def.maxLength,
      value: row?.value ?? def.defaultValue,
      defaultValue: def.defaultValue,
      modified,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}
