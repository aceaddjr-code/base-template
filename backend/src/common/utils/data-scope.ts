import { SelectQueryBuilder } from 'typeorm';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getUserId } from './service-helpers';
import { isSystemAdmin } from './permission-check';
import { deptSubtreeIn } from './dept-subtree';

/** 数据范围类型全集：读侧分发（本模块）与写侧校验（UserDataScopeService）共用同一字符串族 */
export const SCOPE_TYPES = ['self', 'all', 'by_users', 'by_depts'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface UserScopeEntry {
  scopeKey: string;
  scopeType: ScopeType;
  viewOthers?: number;
  editOthers?: number;
  deleteOthers?: number;
  targets?: number[];
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

/** 取用户某表单的数据范围配置（无该表单行回退 __global__，再回退 null） */
export function findScopeEntry(
  user: ScopeUser | null | undefined,
  scopeKey?: string,
): UserScopeEntry | null {
  const list = user?.dataScopes;
  if (!list || !list.length) return null;
  if (scopeKey) {
    const exact = list.find((e) => e.scopeKey === scopeKey);
    if (exact) return exact;
  }
  return list.find((e) => e.scopeKey === '__global__') ?? null;
}

/**
 * 数据级权限隔离条件（owner_id 口径）：
 * 按 scopeKey 取用户配置，缺省回退 __global__，再回退仅本人。
 *    - self → 仅本人；all → 不过滤；by_users → 本人 ∪ 勾选用户；by_depts → 本人 ∪ 勾选部门(含下级部门)
 * 返回 { sql, params }：sql 为 null 表示无过滤（all 档）；调用方自行 andWhere 拼接
 */
export function scopeWhereClause(
  alias: string,
  user: ScopeUser | null | undefined,
  scopeKey?: string,
): { sql: string | null; params: Record<string, any> } {
  const uid = getUserId(user);
  if (uid == null) return { sql:'1 = 0', params:{} };
  if (isSystemAdmin(user)) return { sql: null, params: {} };

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
): SelectQueryBuilder<any> {
  const { sql, params } = scopeWhereClause(alias, user, scopeKey);
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
  op: 'view' | 'edit' | 'delete',
): boolean {
  if (isSystemAdmin(user)) return true;
  const entry = findScopeEntry(user, scopeKey);
  if (!entry) return false; // 无配置 → 不默认放行他人单据操作
  if (op === 'view') return entry.viewOthers === 1;
  if (op === 'edit') return entry.editOthers === 1;
  if (op === 'delete') return entry.deleteOthers === 1;
  return false;
}

export function assertCanOperateOn(
  entity: { ownerId?: number | null } | null | undefined,
  user: ScopeUser | null | undefined,
  scopeKey: string,
  op: 'view' | 'edit' | 'delete',
): void {
  const opText = op === 'view' ? '查看' : op === 'edit' ? '编辑' : '删除';
  if (!entity) throw new NotFoundException('记录不存在');
  if (!user) throw new UnauthorizedException('未登录');
  const uid = getUserId(user);
  if (uid == null) throw new UnauthorizedException('未登录');
  if (isSystemAdmin(user)) return;
  if (entity.ownerId === uid) return; // 本人恒放行
  if (entity.ownerId == null) {
    if (!isSystemAdmin(user)) {
      throw new ForbiddenException(`该单据无归属人，仅管理员可${opText}`);
    }
    return;
  }
  if (!canOperateOthers(user, scopeKey, op)) {
    throw new ForbiddenException(`没有${opText}他人单据的权限`);
  }
  const entry = findScopeEntry(user, scopeKey);
  if (!entry) throw new ForbiddenException(`没有${opText}该记录的权限`);
  // 调用前必须经过同一范围的 SQL 查询；部门目标由 scopeWhereClause 校验。
  if (entry.scopeType === 'all' || entry.scopeType === 'by_depts') return;
  const ownerIds = buildAllowedOwnerIds(user, entry);
  if (!ownerIds.has(entity.ownerId as number)) {
    throw new ForbiddenException(`该记录不在当前数据范围内，无权${opText}`);
  }
}
