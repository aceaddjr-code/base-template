import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserDataScope } from './user-data-scope.entity';
import { UserDataScopeTarget } from './user-data-scope-target.entity';
import { User } from './user.entity';
import { Department } from '../department/department.entity';
import { SCOPE_FORM_REGISTRY, SCOPE_KEYS } from './scope-form.registry';
import { SCOPE_TYPES, type ScopeType, type UserScopeEntry } from '../../common/utils/data-scope';

/** 配置面板行（含行 id，用于编辑回显） */
export interface ScopeConfigRow {
  id: number;
  scopeKey: string;
  scopeType: ScopeType;
  viewOthers: number;
  editOthers: number;
  deleteOthers: number;
  targets: number[];
}

/** 无任何配置时的 __global__ self 兜底行：读侧回退与写侧补齐共用同一口径 */
function defaultGlobalRow(id = 0): ScopeConfigRow {
  return { id, scopeKey: '__global__', scopeType: 'self', viewOthers: 1, editOthers: 0, deleteOthers: 0, targets: [] };
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

  /** 行 + targets 一次装载（会话与面板共用） */
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
      viewOthers: r.viewOthers,
      editOthers: r.editOthers,
      deleteOthers: r.deleteOthers,
      targets: targets.filter((t) => t.userDataScopeId === r.id).map((t) => t.targetId),
    }));
  }

  /** 装载进登录会话的数据范围；无配置回退 __global__ self */
  async loadForSession(userId: number): Promise<UserScopeEntry[]> {
    const rows = await this.loadRows(userId);
    if (!rows.length) {
      const { id: _id, ...entry } = defaultGlobalRow();
      return [entry];
    }
    return rows.map(({ id: _id, ...entry }) => entry);
  }

  /** 配置面板回显；无配置补默认行（id: 0） */
  async getPanelRows(userId: number): Promise<ScopeConfigRow[]> {
    await this.assertUserExists(userId);
    const rows = await this.loadRows(userId);
    return rows.length ? rows : [defaultGlobalRow()];
  }

  /**
   * 保存用户数据范围（全量替换：物理删除 + 插入，事务）。
   * 入参 rows: [{ scopeKey, scopeType, viewOthers, editOthers, deleteOthers, targets }]
   */
  async saveRows(
    userId: number,
    rows: {
      scopeKey: string;
      scopeType: string;
      viewOthers?: number;
      editOthers?: number;
      deleteOthers?: number;
      targets?: number[];
    }[],
    callerId: number,
  ) {
    await this.assertUserExists(userId);
    if (!Array.isArray(rows)) throw new BadRequestException('rows 必须为数组');

    const VALID_TYPES = new Set<string>(SCOPE_TYPES);
    const seen = new Set<string>();
    const clean = rows.map(r => {
      if (!r || !(r.scopeKey === '__global__' || SCOPE_KEYS.has(r.scopeKey)) || !VALID_TYPES.has(r.scopeType)) {
        throw new BadRequestException('数据范围的表单或类型无效');
      }
      if (seen.has(r.scopeKey)) throw new BadRequestException('数据范围表单不能重复');
      seen.add(r.scopeKey);
      const values = [r.viewOthers, r.editOthers, r.deleteOthers];
      if (values.some(value => value !== undefined && value !== 0 && value !== 1)) {
        throw new BadRequestException('操作开关必须为 0 或 1');
      }
      if (r.targets !== undefined && (!Array.isArray(r.targets) || r.targets.some(id => !Number.isInteger(id) || id <= 0))) {
        throw new BadRequestException('数据范围目标必须为正整数 ID');
      }
      const targeted = r.scopeType === 'by_users' || r.scopeType === 'by_depts';
      const targets = targeted ? [...new Set(r.targets ?? [])] : [];
      if (targeted && !targets.length) throw new BadRequestException('请指定数据范围目标');
      return { scopeKey:r.scopeKey, scopeType:r.scopeType, viewOthers:r.viewOthers ?? 0,
        editOthers:r.editOthers ?? 0, deleteOthers:r.deleteOthers ?? 0, targets };
    });
    if (!seen.has('__global__')) clean.unshift({ scopeKey:'__global__', scopeType:'self', viewOthers:1, editOthers:0, deleteOthers:0, targets:[] });
    for (const row of clean) {
      if (!row.targets.length) continue;
      const found = row.scopeType === 'by_users'
        ? await this.userRepo.find({ where: { id: In(row.targets) }, select: { id:true } })
        : await this.deptRepo.find({ where: { id: In(row.targets) }, select: { id:true } });
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
          viewOthers: r.viewOthers,
          editOthers: r.editOthers,
          deleteOthers: r.deleteOthers,
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
