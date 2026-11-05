import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysSetting } from './entities/sys-setting.entity';
import { SETTING_REGISTRY, SettingDefinition, findSettingDefinition } from './setting-registry';
import { getUserId } from '../../common/utils/service-helpers';
import { SystemLogService } from './system-log.service';

export interface SettingView {
  key: string;
  name: string;
  type: 'string' | 'text' | 'boolean';
  public: boolean;
  description: string;
  maxLength: number;
  value: string;
  defaultValue: string;
  modified: boolean;
  updatedAt: string | Date | null;
}

export interface SettingsUpdateItem { key: string; value: string }

@Injectable()
export class SettingService {
  constructor(
    @InjectRepository(SysSetting) private readonly settingRepo: Repository<SysSetting>,
    private readonly logService: SystemLogService,
  ) {}

  /** 注册表顺序输出全部参数；未修改过的键返回默认值（管理列表）。 */
  async listAll(): Promise<{ list: SettingView[]; revision: number }> {
    const rows = await this.settingRepo.find();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return { list: SETTING_REGISTRY.map((def) => this.toView(def, byKey.get(def.key))), revision: this.currentRevision(rows) };
  }

  /** 登录用户可读的公开参数（key → 当前取值），未设置的键返回默认值。 */
  async listPublic(): Promise<Record<string, string>> {
    const rows = await this.settingRepo.find();
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const result: Record<string, string> = {};
    for (const def of SETTING_REGISTRY) {
      if (def.public) result[def.key] = byKey.get(def.key) ?? def.defaultValue;
    }
    return result;
  }

  /** 单键更新（第六批起复用批量同一校验/事务/修订号语义，不可绕过组合约束）。 */
  async updateValue(key: string, rawValue: string, user: any, baseRevision: number): Promise<SettingView> {
    const result = await this.updateBatch([{ key, value: rawValue }], user, baseRevision);
    return result.list.find(item => item.key === key)!;
  }

  /**
   * 原子批量更新：白名单＋重复键拒绝；boolean 规范化；组合校验基于
   * 事务内当前有效值合并本次提交后判定；baseRevision 条件更新冲突→409；
   * 参数写入＋revision 递增＋审计同一事务，失败全部回滚。
   */
  async updateBatch(items: SettingsUpdateItem[], user: any, baseRevision: number): Promise<{ list: SettingView[]; revision: number }> {
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('参数项不能为空');
    if (items.length > SETTING_REGISTRY.length) throw new BadRequestException('参数项数量超出注册表范围');
    const seen = new Set<string>();
    const normalized: Array<{ def: SettingDefinition; value: string }> = [];
    for (const item of items) {
      const def = findSettingDefinition(item.key);
      if (!def) throw new NotFoundException(`参数不存在或未登记：${item.key}`);
      if (seen.has(def.key)) throw new BadRequestException(`重复的参数键：${def.key}`);
      seen.add(def.key);
      normalized.push({ def, value: this.normalize(def, item.value) });
    }

    const updated = await this.settingRepo.manager.transaction(async manager => {
      // 锁定全部设置行做组合校验与条件更新（首次出现的键懒创建行）
      const rows = await manager.find(SysSetting, { lock: { mode: 'pessimistic_write' } });
      const byKey = new Map(rows.map(row => [row.key, row]));
      const revision = this.currentRevision(rows);

      // 乐观并发：baseRevision 必须携带（DTO 已强制），与当前全局修订号比对
      if (baseRevision !== revision) {
        throw new ConflictException({ message: '配置已被其他管理员修改，请载入最新值后重试', reason: 'settings_stale', currentRevision: revision });
      }

      // 合并后的有效值（本次提交覆盖当前值）→ 组合校验
      const effective = new Map(byKey);
      for (const { def, value } of normalized) {
        effective.set(def.key, { ...(byKey.get(def.key) ?? { id: 0, key: def.key }), key: def.key, value } as SysSetting);
      }
      this.validateCombination(normalized.map(({ def }) => def.key), key => effective.get(key)?.value ?? findSettingDefinition(key)?.defaultValue ?? '');

      const uid = getUserId(user);
      for (const { def, value } of normalized) {
        const old = byKey.get(def.key);
        if (old) {
          await manager.update(SysSetting, old.id, { value, updatedBy: uid });
        } else {
          await manager.save(SysSetting, { key: def.key, value, createdBy: uid, updatedBy: uid, ownerId: uid });
        }
        await this.logService.writeInTransaction(manager, {
          userId: uid, username: user?.username, action: 'update',
          entityType: 'system_settings', entityId: old?.id ?? null, entityDesc: def.key,
          detail: JSON.stringify({ ...(old ? { old: { value: old.value } } : {}), new: { value } }),
        });
      }
      // 全局修订号递增（挂在任一行；空表时写入首行由懒创建完成，此处再统一递增）
      const anchor = rows[0] ?? (await manager.findOne(SysSetting, { where: { key: SETTING_REGISTRY[0].key } }));
      if (anchor) {
        await manager.update(SysSetting, anchor.id, { revision: () => 'revision + 1' });
      } else {
        // 首次写入且锚行尚未存在（上面懒创建已 save 至少一行）——重新取锚行
        const created = await manager.findOne(SysSetting, { where: { key: normalized[0].def.key } });
        if (created) await manager.update(SysSetting, created.id, { revision: () => 'revision + 1' });
      }
      return manager.find(SysSetting);
    });

    return this.toResult(updated);
  }

  /** 组合校验（第六批契约）：维护通知启用时内容必须非空。 */
  private validateCombination(changedKeys: string[], valueOf: (key: string) => string) {
    const enabledKey = 'maintenance.notice.enabled';
    const messageKey = 'maintenance.notice.message';
    if (changedKeys.includes(enabledKey) || changedKeys.includes(messageKey)) {
      if (valueOf(enabledKey) === 'true' && !valueOf(messageKey).trim()) {
        throw new BadRequestException({ message: '维护通知启用时内容不能为空', fieldErrors: [{ path: 'items.value', code: 'required', message: '维护通知启用时内容不能为空' }] });
      }
    }
  }

  /** 按注册表类型校验/规范化取值。 */
  private normalize(def: SettingDefinition, rawValue: string): string {
    if (typeof rawValue !== 'string') throw this.invalidValue(def, 'invalid', '参数值必须是字符串');
    if (def.type === 'boolean') {
      const value = rawValue.trim().toLowerCase();
      if (value !== 'true' && value !== 'false') throw this.invalidValue(def, 'invalid', `${def.name}仅接受 true 或 false`);
      return value;
    }
    const value = def.type === 'text' ? rawValue.replace(/\r\n/g, '\n').trim() : rawValue.trim();
    if (value.length > def.maxLength) throw this.invalidValue(def, 'maxlength', `${def.name}最多 ${def.maxLength} 个字符`);
    if (def.required && !value) throw this.invalidValue(def, 'required', `${def.name}不能为空`);
    return value;
  }

  private currentRevision(rows: SysSetting[]): number {
    return rows.reduce((max, row) => Math.max(max, row.revision ?? 0), 0);
  }

  private invalidValue(def: SettingDefinition, code: string, message: string) {
    return new BadRequestException({ message, fieldErrors: [{ path: 'value', code, message }] });
  }

  private toResult(rows: SysSetting[]): { list: SettingView[]; revision: number } {
    const byKey = new Map(rows.map(row => [row.key, row]));
    return { list: SETTING_REGISTRY.map(def => this.toView(def, byKey.get(def.key))), revision: this.currentRevision(rows) };
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
