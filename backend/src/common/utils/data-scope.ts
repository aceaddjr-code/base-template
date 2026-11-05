import { SelectQueryBuilder } from 'typeorm';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getUserId } from './service-helpers';
import { isSystemAdmin } from './permission-check';
import { deptSubtreeIn } from './dept-subtree';

/** 数据范围类型全集：读侧分发（本模块）与写侧校验（UserDataScopeService）共用同一字符串族 */
export const SCOPE_TYPES = ['self', 'all', 'by_users', 'by_depts'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** 操作全集：查看 / 编辑 / 删除；「他人」「本人」两列开关族都由它派生 */
export const SCOPE_OPERATIONS = ['view', 'edit', 'delete'] as const;
export type ScopeOperation = (typeof SCOPE_OPERATIONS)[number];

/** 遗留「所有表单」行的 scopeKey：读侧不再按它回退（未配置表单一律仅本人），仅供旧数据辨识 */
export const GLOBAL_SCOPE_KEY = '__global__';

/** 旧数据未携带开关时的缺省口径：本人开关默认开启，他人开关默认关闭（docs/用户数据范围.md 迁移语义） */
export const SELF_FLAG_DEFAULT = 1;
export const OTHERS_FLAG_DEFAULT = 0;

/** 六个操作开关（0/1）的归一化形状 */
export type ScopeFlags = Record<`${ScopeOperation}Others` | `${ScopeOperation}Self`, number>;

/** 按缺省口径归一化开关：面板回显、写侧兜底与读侧裁决共用，前端不自行复刻缺省值 */
export function normalizeScopeFlags(raw: Partial<ScopeFlags> | null | undefined): ScopeFlags {
  const flags = {} as ScopeFlags;
  for (const op of SCOPE_OPERATIONS) {
    flags[`${op}Others`] = raw?.[`${op}Others`] ?? OTHERS_FLAG_DEFAULT;
    flags[`${op}Self`] = raw?.[`${op}Self`] ?? SELF_FLAG_DEFAULT;
  }
  return flags;
}

export interface UserScopeEntry {
  scopeKey: string;
  scopeType: ScopeType;
  viewOthers?: number;
  editOthers?: number;
  deleteOthers?: number;
  targets?: number[];
  viewSelf?: number;
  editSelf?: number;
  deleteSelf?: number;
}

/** 当前登录用户（JWT payload 或请求 user 对象） */
export interface ScopeUser {
  sub?: number;
  id?: number;
  userId?: number;
  roleCode?: string;
  roles?: string[];
  deptId?: number | null;

  dataScopes?: UserScopeEntry[];
}

/** 取表单独立配置；未配置（含只存遗留 __global__ 行）时为 null，调用方回退仅本人。 */
export function findScopeEntry(
  user: ScopeUser | null | undefined,
  scopeKey?: string,
): UserScopeEntry | null {
  const list = user?.dataScopes;
  if (!list || !list.length) return null;
  if (scopeKey) {
    const exact = list.find((e) => e.scopeKey === scopeKey);
    return exact ?? null;
  }
  return list.find((e) => e.scopeKey === GLOBAL_SCOPE_KEY) ?? null;
}

/**
 * 数据级权限隔离条件（owner_id 口径）：
 * 按 scopeKey 取用户配置，缺省仅本人。
 *    - self → 仅本人；all → 不过滤；by_users → 本人 ∪ 勾选用户；by_depts → 本人 ∪ 勾选部门(含下级部门)
 * 返回 { sql, params }：sql 为 null 表示无过滤（all 档）；调用方自行 andWhere 拼接
 */
export function scopeWhereClause(
  alias: string,
  user: ScopeUser | null | undefined,
  scopeKey?: string,
  operation?: ScopeOperation,
): { sql: string | null; params: Record<string, any> } {
  const uid = getUserId(user);
  if (uid == null) return { sql:'1 = 0', params:{} };
  if (isSystemAdmin(user)) return { sql: null, params: {} };

  if (operation) {
    // 列表按共同范围展示；导出还需满足查看详情开关，避免绕过详情限制（docs/用户数据范围.md）。
    const base = scopeWhereClause(alias, user, scopeKey);
    const gate = scopeOperationGate(alias, user, scopeKey ?? GLOBAL_SCOPE_KEY, operation);
    if (gate.sql == null) return base;
    return { sql: base.sql ? `(${base.sql}) AND (${gate.sql})` : gate.sql, params: { ...base.params, ...gate.params } };
  }
  const entry = findScopeEntry(user, scopeKey);
  if (entry) {
    switch (entry.scopeType) {
      case 'all':
        return { sql: null, params: {} };
      case 'by_users': {
        const targetIds = Array.isArray(entry.targets) ? entry.targets.filter((x) => x != null) : [];
        const userIds = uid != null ? [...new Set([uid, ...targetIds])] : [...new Set(targetIds)];
        if (!userIds.length) break;
        return {
          sql: `${alias}.ownerId IN (:...scopeUserIds)`,
          params: { scopeUserIds: userIds },
        };
      }
      case 'by_depts': {
        const deptIds = Array.isArray(entry.targets) ? entry.targets.filter((x) => x != null) : [];
        if (!deptIds.length) break;
        const selfSql = uid != null ? `${alias}.ownerId = :scopeSelfUid OR ` : '';
        return {
          sql: `(${selfSql}${alias}.ownerId IN (
            SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND (
              u.dept_id IN (:...scopeDeptIds)
              OR ${deptSubtreeIn('id IN (:...scopeDeptIds)')}
            )
          ))`,
          params: uid != null ? { scopeSelfUid: uid, scopeDeptIds: deptIds } : { scopeDeptIds: deptIds },
        };
      }
      case 'self':
      default:
        break;
    }
    // 兜底：仅本人（含无权限信息极端情况强制查不到，不泄露）
    if (uid == null) return { sql: '1 = 0', params: {} };
    return { sql: `${alias}.ownerId = :scopeUserId`, params: { scopeUserId: uid } };
  }

  if (uid == null) return { sql: '1 = 0', params: {} };
  return { sql: `${alias}.ownerId = :scopeUserId`, params: { scopeUserId: uid } };
}

export function buildDataScope(
  qb: SelectQueryBuilder<any>,
  alias: string,
  user: ScopeUser | null | undefined,
  scopeKey?: string,
  operation?: ScopeOperation,
): SelectQueryBuilder<any> {
  const { sql, params } = scopeWhereClause(alias, user, scopeKey, operation);
  if (sql) qb.andWhere(sql, params);
  return qb;
}

/**
 * 操作开关门（owner_id 口径）：只裁决本人/他人开关，不携带共同范围条件。
 * 供已应用共同范围的查询（如导出复用列表查询）叠加，避免同一范围条件拼两遍；
 * sql 为 null 表示无需追加（管理员）。
 */
export function scopeOperationGate(
  alias: string,
  user: ScopeUser | null | undefined,
  scopeKey: string,
  operation: ScopeOperation,
): { sql: string | null; params: Record<string, any> } {
  const uid = getUserId(user);
  if (uid == null) return { sql: '1 = 0', params: {} };
  if (isSystemAdmin(user)) return { sql: null, params: {} };
  const own = normalizeScopeFlags(findScopeEntry(user, scopeKey))[`${operation}Self`] === 1;
  const others = canOperateOthers(user, scopeKey, operation);
  if (!own && !others) return { sql: '1 = 0', params: {} };
  if (own && others) return { sql: `${alias}.ownerId IS NOT NULL`, params: {} };
  return { sql: `${alias}.ownerId ${own ? '=' : '<>'} :scopeOpUserId`, params: { scopeOpUserId: uid } };
}

/** scopeOperationGate 的 QueryBuilder 版本：有条件时 andWhere 拼接。 */
export function buildOperationGate(
  qb: SelectQueryBuilder<any>,
  alias: string,
  user: ScopeUser | null | undefined,
  scopeKey: string,
  operation: ScopeOperation,
): SelectQueryBuilder<any> {
  const { sql, params } = scopeOperationGate(alias, user, scopeKey, operation);
  if (sql) qb.andWhere(sql, params);
  return qb;
}

function buildAllowedOwnerIds(
  user: ScopeUser | null | undefined,
  entry: UserScopeEntry,
): Set<number> {
  const ids = new Set<number>();
  const selfId = getUserId(user);
  if (selfId != null) ids.add(selfId);
  if (!entry.targets?.length) return ids;
  if (entry.scopeType === 'by_users') {
    for (const t of entry.targets) if (t != null) ids.add(t);
  }
  // by_depts 由列表层 scopeWhereClause 过滤；assertCanOperateOn 仅校验 op 开关
  return ids;
}

export function canEditOwner(user: ScopeUser | null | undefined): boolean {
  return isSystemAdmin(user);
}

export function canOperateOthers(
  user: ScopeUser | null | undefined,
  scopeKey: string,
  op: ScopeOperation,
): boolean {
  if (isSystemAdmin(user)) return true;
  const entry = findScopeEntry(user, scopeKey);
  if (!entry) return false; // 无配置 → 不默认放行他人单据操作
  return entry[`${op}Others`] === 1;
}

/** 本人/他人操作开关裁决结果：不抛异常，由调用方决定是 throw（运行时守卫）还是 report（解释）。 */
export type OperationSwitchVerdict =
  | { allowed: true; reason: 'admin_exception' | 'self_switch_on' | 'others_switch_on' }
  | { allowed: false; reason: 'self_switch_off' | 'others_switch_off' | 'no_owner' };

/**
 * 裁决某用户对某条记录的指定操作开关（查看/编辑/删除的本人/他人维度）。
 * 这是运行时守卫（assertCanOperateOn）与权限解释服务共用的唯一裁决核心——
 * 修改开关语义只改此处，两个消费者自动跟随。
 */
export function evaluateOperationSwitch(
  entity: { ownerId?: number | null },
  user: ScopeUser | null | undefined,
  scopeKey: string,
  op: ScopeOperation,
): OperationSwitchVerdict {
  if (isSystemAdmin(user)) return { allowed: true, reason: 'admin_exception' };
  const uid = getUserId(user);
  const flags = normalizeScopeFlags(findScopeEntry(user, scopeKey));
  if (entity.ownerId == null) return { allowed: false, reason: 'no_owner' };
  if (entity.ownerId === uid) {
    return flags[`${op}Self`] === 1
      ? { allowed: true, reason: 'self_switch_on' }
      : { allowed: false, reason: 'self_switch_off' };
  }
  return flags[`${op}Others`] === 1
    ? { allowed: true, reason: 'others_switch_on' }
    : { allowed: false, reason: 'others_switch_off' };
}

export function assertCanOperateOn(
  entity: { ownerId?: number | null } | null | undefined,
  user: ScopeUser | null | undefined,
  scopeKey: string,
  op: ScopeOperation,
): void {
  const opText = op === 'view' ? '查看' : op === 'edit' ? '编辑' : '删除';
  if (!entity) throw new NotFoundException('记录不存在');
  if (!user) throw new UnauthorizedException('未登录');
  const uid = getUserId(user);
  if (uid == null) throw new UnauthorizedException('未登录');

  // 本人/他人开关裁决：与权限解释服务共用同一核心
  const verdict = evaluateOperationSwitch(entity, user, scopeKey, op);
  if (verdict.allowed) {
    // by_users 范围的归属人列表校验是运行时守卫专有（解释服务经 SQL 范围查询处理）
    if (verdict.reason === 'others_switch_on') {
      const entry = findScopeEntry(user, scopeKey);
      if (!entry) throw new ForbiddenException(`没有${opText}该记录的权限`);
      // 调用前必须经过同一范围的 SQL 查询；部门目标由 scopeWhereClause 校验。
      if (entry.scopeType === 'all' || entry.scopeType === 'by_depts') return;
      const ownerIds = buildAllowedOwnerIds(user, entry);
      if (!ownerIds.has(entity.ownerId as number)) {
        throw new ForbiddenException(`该记录不在当前数据范围内，无权${opText}`);
      }
    }
    return;
  }
  if (verdict.reason === 'no_owner') {
    throw new ForbiddenException(`该单据无归属人，仅管理员可${opText}`);
  }
  if (verdict.reason === 'self_switch_off') {
    throw new ForbiddenException(`没有${opText}本人单据的权限`);
  }
  throw new ForbiddenException(`没有${opText}他人单据的权限`);
}
