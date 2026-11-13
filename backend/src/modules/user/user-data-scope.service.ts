import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserDataScope } from './user-data-scope.entity';
import { UserDataScopeTarget } from './user-data-scope-target.entity';
import { User } from './user.entity';
import { Department } from '../department/department.entity';
import { SCOPE_FORM_REGISTRY, SCOPE_KEYS } from './scope-form.registry';
import {
  GLOBAL_SCOPE_KEY, SCOPE_OPERATIONS, SCOPE_TYPES, normalizeScopeFlags,
  type ScopeFlags, type ScopeType, type UserScopeEntry,
} from '../../common/utils/data-scope';

/** 配置面板行（含行 id，用于编辑回显）；开关值已按缺省口径归一化 */
export interface ScopeConfigRow extends ScopeFlags {
  id: number;
  scopeKey: string;
  scopeType: ScopeType;
  targets: number[];
}

/**
 * 数据范围配置的唯一拥有者：登录会话装载（auth 签发）、配置面板回显与全量替换保存
 * 都从这里取数。此前 auth 与 user 各自查询映射、各自硬编码 __global__ 兜底，已收敛至此。
 */
@Injectable()
export class UserDataScopeService {
  constructor(
    @InjectRepository(UserDataScope)
    private readonly userDataScopeRepo: Repository<UserDataScope>,
    @InjectRepository(UserDataScopeTarget)
    private readonly userDataScopeTargetRepo: Repository<UserDataScopeTarget>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
  ) {}

  /** 可配置表单清单（唯一真相源，供前端数据范围配置面板 / 校验共用） */
  listScopeForms() {
    return SCOPE_FORM_REGISTRY;
  }

  /** 行 + targets 一次装载（会话与面板共用）；开关按缺省口径归一化，是唯一的缺省真相源 */
  private async loadRows(userId: number): Promise<ScopeConfigRow[]> {
    const rows = await this.userDataScopeRepo.find({ where: { userId }, order: { id: 'ASC' } });
    const ids = rows.map((r) => r.id);
    const targets = ids.length
      ? await this.userDataScopeTargetRepo.find({ where: { userDataScopeId: In(ids) } })
      : [];
    return rows.map((r) => ({
      id: r.id,
      scopeKey: r.scopeKey,
      // 实体列为 string；入库值均经 saveRows 按 SCOPE_TYPES 校验，读取时收窄
      scopeType: r.scopeType as ScopeType,
      ...normalizeScopeFlags(r),
      targets: targets.filter((t) => t.userDataScopeId === r.id).map((t) => t.targetId),
    }));
  }

  /** 装载进登录会话的数据范围；无配置返回空数组，读侧对未配置表单按仅本人回退 */
  async loadForSession(userId: number): Promise<UserScopeEntry[]> {
    return (await this.loadRows(userId)).map(({ id: _id, ...entry }) => entry);
  }

  /** 配置面板只编辑可见范围。旧限制保留到管理员重新保存。 */
  async getPanelRows(userId: number) {
    await this.assertUserExists(userId);
    return (await this.loadRows(userId)).map(row => ({
      id: row.id,
      scopeKey: row.scopeKey,
      scopeType: row.scopeType,
      targets: row.targets,
      legacyRestricted: SCOPE_OPERATIONS.some(op =>
        row[`${op}Self`] !== 1 || (row.scopeType !== 'self' && row[`${op}Others`] !== 1),
      ),
    }));
  }

  /**
   * 保存用户数据范围（全量替换：物理删除 + 插入，事务）。
   * 入参只配置范围。旧列继续保留，存量用户重新保存后才取消旧开关的额外限制。
   */
  async saveRows(
    userId: number,
    rows: {
      scopeKey: string;
      scopeType: string;
      targets?: number[];
    }[],
    callerId: number,
  ) {
    await this.assertUserExists(userId);
    if (!Array.isArray(rows)) throw new BadRequestException('rows 必须为数组');

    const VALID_TYPES = new Set<string>(SCOPE_TYPES);
    const seen = new Set<string>();
    const clean = rows.map(r => {
      if (!r || r.scopeKey === GLOBAL_SCOPE_KEY) {
        // __global__ 是遗留「所有表单」行，读侧已不回退；按表单直接配置，不再接受或补写
        throw new BadRequestException('数据范围需按表单直接配置，不再支持所有表单默认值');
      }
      if (!SCOPE_KEYS.has(r.scopeKey) || !VALID_TYPES.has(r.scopeType)) {
        throw new BadRequestException('数据范围的表单或类型无效');
      }
      if (seen.has(r.scopeKey)) throw new BadRequestException('数据范围表单不能重复');
      seen.add(r.scopeKey);
      if (SCOPE_OPERATIONS.some(op => `${op}Self` in r || `${op}Others` in r)) {
        throw new BadRequestException('数据范围只配置可见范围，请刷新后重试');
      }
      if (r.targets !== undefined && (!Array.isArray(r.targets) || r.targets.some(id => !Number.isInteger(id) || id <= 0))) {
        throw new BadRequestException('数据范围目标必须为正整数 ID');
      }
      const targeted = r.scopeType === 'by_users' || r.scopeType === 'by_depts';
      const targets = targeted ? [...new Set(r.targets ?? [])] : [];
      if (targeted && !targets.length) throw new BadRequestException('请指定数据范围目标');
      return { scopeKey: r.scopeKey, scopeType: r.scopeType, targets };
    });
    for (const row of clean) {
      if (!row.targets.length) continue;
      const found = row.scopeType === 'by_users'
        ? await this.userRepo.find({ where: { id: In(row.targets) }, select: { id: true } })
        : await this.deptRepo.find({ where: { id: In(row.targets) }, select: { id: true } });
      if (found.length !== row.targets.length) throw new BadRequestException('数据范围包含不存在的目标');
    }

    await this.userDataScopeRepo.manager.transaction(async (manager) => {
      // 先取旧配置 id 以便级联清 targets
      const oldRows = await manager.find(UserDataScope, { where: { userId } });
      const oldIds = oldRows.map((r) => r.id);
      if (oldIds.length) await manager.delete(UserDataScopeTarget, { userDataScopeId: In(oldIds) });
      await manager.delete(UserDataScope, { userId });
      for (const r of clean) {
        const saved = await manager.save(UserDataScope, {
          userId,
          scopeKey: r.scopeKey,
          scopeType: r.scopeType,
          viewOthers: 1,
          editOthers: 1,
          deleteOthers: 1,
          viewSelf: 1,
          editSelf: 1,
          deleteSelf: 1,
          ownerId: userId,
          createdBy: callerId,
        });
        if (r.targets.length) {
          await manager.save(
            UserDataScopeTarget,
            r.targets.map((tid) => ({
              userDataScopeId: saved.id,
              targetType: r.scopeType === 'by_users' ? 'user' : 'dept',
              targetId: tid,
              ownerId: userId,
              createdBy: callerId,
            })),
          );
        }
      }
      await manager.increment(User, { id:userId }, 'tokenVersion', 1);
    });
    return this.getPanelRows(userId);
  }

  private async assertUserExists(userId: number) {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
  }
}
