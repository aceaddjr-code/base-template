import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { Department } from '../department/department.entity';
import { ExampleItem } from '../example/example-item.entity';
import { SCOPE_FORM_REGISTRY } from '../user/scope-form.registry';
import { AuthService } from './auth.service';
import { SystemLogService } from '../system/system-log.service';
import {
  buildDataScope, findScopeEntry, normalizeScopeFlags, type ScopeUser, type UserScopeEntry,
} from '../../common/utils/data-scope';
import {
  ACTION_PERMISSION_CODES, EXPLAIN_ACTIONS, EXPLAIN_REASONS, RECORD_EXPLAINABLE_SCOPE_KEY,
  type ExplainAction, type ExplainReason, type OperationPermissionExplanation,
  type PermissionExplanationResponse, type PermissionSourceRole, type RecordActionEvaluation,
} from '../user/permission-explanation.contracts';

/**
 * 权限效果解释（第二批规格）：按目标用户**当前配置**推演“重新登录后的预计效果”，
 * 不模拟、不读取目标现存 JWT，不签发 Token、不改 tokenVersion。
 *
 * 复用边界：角色/范围解析来自 AuthService 同一实现（buildEffectiveIdentity），
 * 权限码来自 getUserAccessCodes；共同范围判定用与实际列表同源的
 * buildDataScope（scopeWhereClause）做 EXISTS，不另写授权引擎，也不以
 * assertCanOperateOn 代替部门范围 SQL。业务状态仅按 action-map §1 的既定事实
 * （乐观锁、编辑附加查看资格）作解释性标注。
 */
@Injectable()
export class PermissionExplanationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly deptRepo: Repository<Department>,
    @InjectRepository(ExampleItem)
    private readonly exampleRepo: Repository<ExampleItem>,
    private readonly authService: AuthService,
    private readonly logService: SystemLogService,
  ) {}

  async explain(
    targetId: number,
    scopeKey: string,
    recordId: number | null,
    caller: { sub: number; username: string },
    meta?: { ip?: string | null },
  ): Promise<PermissionExplanationResponse> {
    const registry = SCOPE_FORM_REGISTRY.find((item) => item.scopeKey === scopeKey);
    if (!registry) throw new BadRequestException('未知业务表单，请从已注册表单中选择');

    const target = await this.userRepo.findOne({
      where: { id: targetId },
      select: { id: true, username: true, displayName: true, status: true, mustChangePassword: true, tokenVersion: true, roleId: true, deptId: true },
    });
    if (!target) throw new NotFoundException('用户不存在或已删除');

    const identity = await this.authService.buildEffectiveIdentity(targetId);
    const isAdmin = identity.roles.includes('admin');
    // getUserAccessCodes 按目标当前版本解析（账号禁用时为空，与运行时一致）
    const effectiveCodes = new Set(await this.authService.getUserAccessCodes({ id: targetId }));
    const sources = await this.loadPermissionSources(targetId, target.roleId);

    const entry = identity.dataScopes.find((item: UserScopeEntry) => item.scopeKey === scopeKey) ?? null;
    const flags = normalizeScopeFlags(entry);
    const dataScope = await this.describeDataScope(entry, flags);

    const operationPermissions: OperationPermissionExplanation[] = EXPLAIN_ACTIONS.map((action) => {
      const code = ACTION_PERMISSION_CODES[action];
      return {
        action,
        permissionCode: code,
        effective: isAdmin || effectiveCodes.has(code),
        sources: sources.get(code) ?? [],
        adminException: isAdmin,
      };
    });

    let recordEvaluation: RecordActionEvaluation[] | null = null;
    let record: PermissionExplanationResponse['record'] = null;
    if (recordId != null) {
      if (scopeKey !== RECORD_EXPLAINABLE_SCOPE_KEY) {
        recordEvaluation = EXPLAIN_ACTIONS.map((action) => unsupported(action));
      } else {
        const evaluation = await this.evaluateRecord(recordId, targetId, identity, isAdmin, effectiveCodes, entry, target);
        recordEvaluation = evaluation.evaluations;
        record = evaluation.record;
      }
    }

    const response: PermissionExplanationResponse = {
      evaluatedAt: new Date().toISOString(),
      targetUserId: targetId,
      tokenVersion: target.tokenVersion,
      configSource: {
        scopeKey,
        scopeFormLabel: registry.label,
        configured: !!entry,
        fallback: entry ? null : 'self_only',
      },
      account: { status: Number(target.status) === 1 ? 1 : 0, mustChangePassword: Number(target.mustChangePassword) === 1 },
      operationPermissions,
      dataScope,
      recordEvaluation,
      ...(recordId != null ? { record } : {}),
    };
    // 管理审计：只记目标、表单与是否查询记录，不含业务正文
    void this.logService.write({
      userId: caller.sub,
      username: caller.username,
      action: 'update',
      entityType: 'users',
      entityId: targetId,
      detail: JSON.stringify({ event: 'permission_explain', scopeKey, recordQueried: recordId != null }),
      ip: meta?.ip ?? null,
    }).catch(() => undefined);
    return response;
  }

  /** 授予各权限码的角色来源（含停用角色，透明展示启用状态；有效码由 getUserAccessCodes 裁决）。 */
  private async loadPermissionSources(userId: number, mainRoleId: number | null): Promise<Map<string, PermissionSourceRole[]>> {
    const rows = await this.userRepo.manager.query(
      `SELECT DISTINCT r.id AS roleId, r.code AS roleCode, r.name AS roleName, r.status AS roleStatus, m.permission AS permission
       FROM (
         SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ? AND ur.deleted_at IS NULL
         UNION SELECT ? AS role_id
       ) owned
       JOIN roles r ON r.id = owned.role_id AND r.deleted_at IS NULL
       JOIN role_menus rm ON rm.role_id = r.id
       JOIN menus m ON m.id = rm.menu_id AND m.deleted_at IS NULL AND m.status = 1 AND m.type = 'button'
       WHERE m.permission IN (?, ?, ?, ?, ?)`,
      [userId, mainRoleId, ...Object.values(ACTION_PERMISSION_CODES)],
    ) as Array<{ roleId: number; roleCode: string; roleName: string; roleStatus: number; permission: string }>;
    const map = new Map<string, PermissionSourceRole[]>();
    for (const row of rows) {
      const list = map.get(row.permission) ?? [];
      list.push({ roleId: Number(row.roleId), roleCode: row.roleCode, roleName: row.roleName, roleEnabled: Number(row.roleStatus) === 1 });
      map.set(row.permission, list);
    }
    return map;
  }

  private async describeDataScope(entry: UserScopeEntry | null, flags: ReturnType<typeof normalizeScopeFlags>): Promise<PermissionExplanationResponse['dataScope']> {
    const scopeType = entry?.scopeType ?? 'fallback_self';
    const description = this.describeScopeType(scopeType);
    const result: PermissionExplanationResponse['dataScope'] = { scopeType, flags, description };
    if (entry?.scopeType === 'by_users' && entry.targets?.length) {
      const users = await this.userRepo.find({ where: { id: In(entry.targets) }, withDeleted: true, select: { id: true, username: true, displayName: true } });
      result.targetUsers = users.map((u) => ({ id: u.id, label: u.displayName || u.username }));
    }
    if (entry?.scopeType === 'by_depts' && entry.targets?.length) {
      const depts = await this.deptRepo.find({ where: { id: In(entry.targets) }, withDeleted: true, select: { id: true, name: true } });
      result.targetDepts = depts.map((d) => ({ id: d.id, label: d.name }));
    }
    return result;
  }

  private describeScopeType(scopeType: string): string {
    switch (scopeType) {
      case 'all': return '全部数据（不过滤归属）';
      case 'by_users': return '本人 ∪ 指定用户的单据';
      case 'by_depts': return '本人 ∪ 指定部门（含其全部下级部门）成员的单据';
      case 'self': return '仅本人单据';
      default: return '该表单未配置数据范围，按缺省口径回退为仅本人';
    }
  }

  private async evaluateRecord(
    recordId: number,
    targetId: number,
    identity: { roles: string[]; dataScopes: UserScopeEntry[] },
    isAdmin: boolean,
    effectiveCodes: Set<string>,
    entry: UserScopeEntry | null,
    target: { status: number; mustChangePassword: number },
  ): Promise<{ evaluations: RecordActionEvaluation[]; record: PermissionExplanationResponse['record'] }> {
    const row = await this.exampleRepo.findOne({
      where: { id: recordId },
      withDeleted: true,
      select: { id: true, docNo: true, title: true, ownerId: true, deletedAt: true },
    });
    const ownerLabel = row?.ownerId != null ? await this.ownerLabel(row.ownerId) : null;
    const record = row
      ? { id: row.id, docNo: (row as any).docNo ?? null, title: (row as any).title ?? '', ownerId: row.ownerId ?? null, ownerLabel, deleted: row.deletedAt != null }
      : null;

    const deniedAll = (codes: ExplainReason[], text: string): RecordActionEvaluation[] =>
      EXPLAIN_ACTIONS.map((action) => ({ action, result: 'denied' as const, reasonCodes: codes, readableReason: text }));
    if (!row || row.deletedAt) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.RECORD_NOT_FOUND], '记录不存在、已删除或不在该用户的数据范围内（与实际访问口径一致，不区分三者）'), record };
    }
    if (Number(target.status) !== 1) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.ACCOUNT_DISABLED], '目标账号已禁用，无法登录，一切业务接口不可用'), record };
    }
    if (Number(target.mustChangePassword) === 1) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.ACCOUNT_MUST_CHANGE_PASSWORD], '目标账号处于待改密状态，受限会话只能访问个人信息、本人改密与登出'), record };
    }
    if (isAdmin) {
      return {
        evaluations: EXPLAIN_ACTIONS.map((action) => ({
          action,
          result: 'allowed' as const,
          reasonCodes: action === 'update' ? [EXPLAIN_REASONS.ADMIN_EXCEPTION, EXPLAIN_REASONS.OPTIMISTIC_LOCK] : [EXPLAIN_REASONS.ADMIN_EXCEPTION],
          readableReason: action === 'update'
            ? '系统管理员例外放行；并发修改时以版本乐观锁裁决，内容过期需刷新后重试'
            : '系统管理员例外放行',
        })),
        record,
      };
    }

    // 共同范围：与实际列表同源的 SQL 判定（含部门子树），不用 assertCanOperateOn 代替
    const scopeUser: ScopeUser = { id: targetId, roles: identity.roles, dataScopes: identity.dataScopes };
    const qb = this.exampleRepo.createQueryBuilder('t')
      .select('t.id', 'id')
      .where('t.id = :recordId AND t.deleted_at IS NULL', { recordId });
    buildDataScope(qb, 't', scopeUser, RECORD_EXPLAINABLE_SCOPE_KEY);
    const inScope = !!(await qb.getRawOne());

    const flags = normalizeScopeFlags(entry);
    const ownerId = row.ownerId ?? null;
    const switchFor = (operation: 'view' | 'edit' | 'delete'): { ok: boolean; reason: ExplainReason } | 'no_owner' => {
      if (ownerId == null) return 'no_owner';
      return ownerId === targetId
        ? { ok: flags[`${operation}Self`] === 1, reason: EXPLAIN_REASONS.SELF_SWITCH_OFF }
        : { ok: flags[`${operation}Others`] === 1, reason: EXPLAIN_REASONS.OTHERS_SWITCH_OFF };
    };

    const evaluations: RecordActionEvaluation[] = EXPLAIN_ACTIONS.map((action) => {
      const code = ACTION_PERMISSION_CODES[action];
      if (!effectiveCodes.has(code)) {
        return denied(action, [EXPLAIN_REASONS.OPERATION_PERMISSION_MISSING], `缺少操作权限码 ${code}（按当前角色授权，重新登录后生效）`);
      }
      if (!inScope) {
        return denied(action, [EXPLAIN_REASONS.RECORD_NOT_FOUND], '记录不在该用户的共同数据范围内（本人/指定用户/指定部门子树口径）');
      }
      if (action === 'list') {
        return allowed(action, [], '记录落入列表共同范围，列表可见（列表可见不代表可查看详情）');
      }
      const view = switchFor('view');
      if (view === 'no_owner') {
        return denied(action, [EXPLAIN_REASONS.NO_OWNER_RECORD], '记录无归属人，仅系统管理员可操作');
      }
      if (action === 'detail' || action === 'export') {
        if (!view.ok) return denied(action, [view.reason], view.reason === EXPLAIN_REASONS.SELF_SWITCH_OFF ? '查看本人单据开关已关闭' : '查看他人单据开关已关闭');
        return allowed(action, [], action === 'export' ? '列表共同范围且查看详情开关开启（导出使用详情查看开关）' : '共同范围内且查看开关开启');
      }
      const op = switchFor(action === 'update' ? 'edit' : 'delete');
      if (op === 'no_owner') {
        return denied(action, [EXPLAIN_REASONS.NO_OWNER_RECORD], '记录无归属人，仅系统管理员可操作');
      }
      if (!op.ok) {
        return denied(action, [op.reason], op.reason === EXPLAIN_REASONS.SELF_SWITCH_OFF ? `编辑/删除本人单据的开关已关闭（${action}）` : `编辑/删除他人单据的开关已关闭（${action}）`);
      }
      if (action === 'update' && !view.ok) {
        return denied(action, [EXPLAIN_REASONS.EDIT_REQUIRES_VIEW], '编辑附加查看资格：编辑开关开启但查看开关不满足');
      }
      const reasons: ExplainReason[] = action === 'update' ? [EXPLAIN_REASONS.OPTIMISTIC_LOCK] : [];
      return allowed(action, reasons, action === 'update'
        ? '允许编辑；并发修改以版本乐观锁裁决，内容过期需刷新后重试'
        : '允许删除（删除进入两阶段回收站流程）');
    });
    return { evaluations, record };
  }

  private async ownerLabel(ownerId: number): Promise<string | null> {
    const owner = await this.userRepo.findOne({ where: { id: ownerId }, withDeleted: true, select: { id: true, username: true, displayName: true } });
    return owner ? owner.displayName || owner.username : `用户#${ownerId}`;
  }
}

function denied(action: ExplainAction, reasonCodes: ExplainReason[], readableReason: string): RecordActionEvaluation {
  return { action, result: 'denied', reasonCodes, readableReason };
}
function allowed(action: ExplainAction, reasonCodes: ExplainReason[], readableReason: string): RecordActionEvaluation {
  return { action, result: 'allowed', reasonCodes, readableReason };
}
function unsupported(action: ExplainAction): RecordActionEvaluation {
  return { action, result: 'unsupported', reasonCodes: [EXPLAIN_REASONS.UNSUPPORTED_ACTION], readableReason: '记录级诊断当前仅支持示例事项；该动作不支持解释，不能推导为允许' };
}
