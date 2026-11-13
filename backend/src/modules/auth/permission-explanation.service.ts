import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { Department } from '../department/department.entity';
import { ExampleItem } from '../example/example-item.entity';
import { ExampleItemMember } from '../example/example-member.entity';
import { exampleMemberScopeVisibility } from '../example/example-member-visibility';
import { SCOPE_FORM_REGISTRY } from '../user/scope-form.registry';
import { IdentityService } from './identity.service';
import { SystemLogService } from '../system/system-log.service';
import { ATTACHMENTS_SCOPE_KEY } from '../attachment/attachment-access';
import { findAttachmentTarget } from '../attachment/attachment-targets.registry';
import { explainAttachment, fileLibraryActions } from './attachment-permission-explanation';
import {
  buildDataScope, evaluateOperationSwitch, findScopeEntry, normalizeScopeFlags, otherRecordPermission, type ScopeUser, type UserScopeEntry,
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
    private readonly identity: IdentityService,
    private readonly logService: SystemLogService,
  ) {}

  async explain(
    targetId: number,
    scopeKey: string,
    recordRef: { id?: number; docNo?: string } | null,
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

    const identity = await this.identity.buildEffectiveIdentity(targetId);
    const isAdmin = identity.roles.includes('admin');
    // getUserAccessCodes 按目标当前版本解析（账号禁用时为空，与运行时一致）；
    // 携带 roleCode 与 JWT payload 同口径，使无角色用户获得与真实会话一致的缺省回退。
    const effectiveCodes = new Set(await this.identity.getUserAccessCodes({ id: targetId, roleCode: identity.roles[0] }));
    const entry = identity.dataScopes.find((item: UserScopeEntry) => item.scopeKey === scopeKey) ?? null;
    const files = scopeKey === ATTACHMENTS_SCOPE_KEY;
    const scopeUser: ScopeUser = { id: targetId, roles: identity.roles, dataScopes: identity.dataScopes, accessCodes: [...effectiveCodes] };
    const accountReason = Number(target.status) !== 1 ? EXPLAIN_REASONS.ACCOUNT_DISABLED
      : Number(target.mustChangePassword) === 1 ? EXPLAIN_REASONS.ACCOUNT_MUST_CHANGE_PASSWORD : undefined;
    if (files && recordRef && !recordRef.id) throw new BadRequestException('附件诊断需要数字文件 ID');
    const file = files && recordRef?.id
      ? await explainAttachment(this.exampleRepo.manager, recordRef.id, scopeUser, isAdmin, effectiveCodes, accountReason)
      : null;
    const boundTarget = file?.row?.origin === 'business' && file.row.status === 'bound'
      ? findAttachmentTarget(file.row.entityType) : null;
    const explainedEntry = boundTarget ? findScopeEntry(scopeUser, boundTarget.scopeKey) : entry;
    const dataScope = await this.describeDataScope(explainedEntry, normalizeScopeFlags(explainedEntry));
    // 示例事项的团队成员口径：成员身份在共同范围之外额外提供可见性（操作仍由角色权限码决定）
    if (scopeKey === RECORD_EXPLAINABLE_SCOPE_KEY) {
      dataScope.description += '；此外，作为单据团队成员的记录同样可见（操作由该用户角色权限码决定）';
    }
    const actions: Array<{ action: ExplainAction; codes: string[] }> = files ? file?.actions ?? fileLibraryActions
      : EXPLAIN_ACTIONS.map(action => ({ action, codes: [ACTION_PERMISSION_CODES[action]] }));
    const permissionCodes = [...new Set(actions.flatMap(item => item.codes))];
    const sources = await this.loadPermissionSources(targetId, target.roleId, permissionCodes);
    const operationPermissions: OperationPermissionExplanation[] = actions.map(({ action, codes }) => ({
      action,
      permissionCode: codes.join(' + ') || '无独立权限码',
      effective: isAdmin || codes.every(code => effectiveCodes.has(code)),
      sources: [...new Map(codes.flatMap(code => sources.get(code) ?? []).map(role => [role.roleId, role] as const)).values()],
      adminException: isAdmin,
    }));

    let recordEvaluation: RecordActionEvaluation[] | null = null;
    let record: PermissionExplanationResponse['record'] = null;
    if (recordRef != null) {
      if (file) {
        recordEvaluation = file.evaluations;
        const row = file.row;
        record = row ? {
          id: row.id, docNo: null, title: row.originalName, ownerId: row.ownerId ?? null,
          ownerLabel: row.ownerId == null ? null : await this.ownerLabel(row.ownerId), deleted: !!row.deletedAt,
        } : null;
        if (row?.origin === 'business') {
          dataScope.description = row.status === 'bound'
            ? '已挂接附件按所属单据裁决。' + (boundTarget ? dataScope.description : '当前附件来源未登记。')
            : '未挂接暂存附件仅上传者或系统管理员可操作';
        }
      } else if (scopeKey !== RECORD_EXPLAINABLE_SCOPE_KEY) {
        recordEvaluation = EXPLAIN_ACTIONS.map((action) => unsupported(action));
      } else {
        const evaluation = await this.evaluateRecord(recordRef, targetId, identity, isAdmin, effectiveCodes, entry, target);
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
        configured: !!explainedEntry,
        fallback: explainedEntry ? null : 'self_only',
      },
      account: { status: Number(target.status) === 1 ? 1 : 0, mustChangePassword: Number(target.mustChangePassword) === 1 },
      operationPermissions,
      dataScope,
      recordEvaluation,
      ...(recordRef != null ? { record } : {}),
    };
    // 管理审计：只记目标、表单与是否查询记录，不含业务正文
    void this.logService.write({
      userId: caller.sub,
      username: caller.username,
      action: 'update',
      entityType: 'users',
      entityId: targetId,
      detail: JSON.stringify({ event: 'permission_explain', scopeKey, recordQueried: recordRef != null }),
      ip: meta?.ip ?? null,
    }).catch(() => undefined);
    return response;
  }

  /** 授予各权限码的角色来源（含停用角色，透明展示启用状态；有效码由 getUserAccessCodes 裁决）。 */
  private async loadPermissionSources(userId: number, mainRoleId: number | null, codes: string[]): Promise<Map<string, PermissionSourceRole[]>> {
    if (!codes.length) return new Map();
    const rows = await this.userRepo.manager.query(
      `SELECT DISTINCT r.id AS roleId, r.code AS roleCode, r.name AS roleName, r.status AS roleStatus, m.permission AS permission
       FROM (
         SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ? AND ur.deleted_at IS NULL
         UNION SELECT ? AS role_id
       ) owned
       JOIN roles r ON r.id = owned.role_id AND r.deleted_at IS NULL
       JOIN role_menus rm ON rm.role_id = r.id
       JOIN menus m ON m.id = rm.menu_id AND m.deleted_at IS NULL AND m.status = 1 AND m.type = 'button'
       WHERE m.permission IN (${codes.map(() => '?').join(', ')})`,
      [userId, mainRoleId, ...codes],
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
    recordRef: { id?: number; docNo?: string },
    targetId: number,
    identity: { roles: string[]; dataScopes: UserScopeEntry[] },
    isAdmin: boolean,
    effectiveCodes: Set<string>,
    entry: UserScopeEntry | null,
    target: { status: number; mustChangePassword: number },
  ): Promise<{ evaluations: RecordActionEvaluation[]; record: PermissionExplanationResponse['record'] }> {
    // 单据编号全库唯一（含软删行共用编号空间），与数字 ID 等价定位同一条记录
    const row = await this.exampleRepo.findOne({
      where: recordRef.docNo ? { docNo: recordRef.docNo } : { id: recordRef.id! },
      withDeleted: true,
      select: { id: true, docNo: true, title: true, ownerId: true, deletedAt: true },
    });
    const ownerLabel = row?.ownerId != null ? await this.ownerLabel(row.ownerId) : null;
    const record = row
      ? { id: row.id, docNo: (row as any).docNo ?? null, title: (row as any).title ?? '', ownerId: row.ownerId ?? null, ownerLabel, deleted: row.deletedAt != null }
      : null;

    const deniedAll = (codes: ExplainReason[], text: string): RecordActionEvaluation[] =>
      EXPLAIN_ACTIONS.map((action) => ({ action, result: 'denied' as const, reasonCodes: codes, readableReason: text }));
    // 分层顺序（规格）：账号可用性 → … → 共同范围；禁用/待改密目标的记录级诊断也应优先报告账号原因
    if (Number(target.status) !== 1) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.ACCOUNT_DISABLED], '目标账号已禁用，无法登录，一切业务接口不可用'), record };
    }
    if (Number(target.mustChangePassword) === 1) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.ACCOUNT_MUST_CHANGE_PASSWORD], '目标账号处于待改密状态，受限会话只能访问个人信息、本人改密与登出'), record };
    }
    if (!row || row.deletedAt) {
      return { evaluations: deniedAll([EXPLAIN_REASONS.RECORD_NOT_FOUND], '记录不存在、已删除或不在该用户的数据范围内（与实际访问口径一致，不区分三者）'), record };
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

    // 共同范围：与实际列表同源的 SQL 判定（含部门子树与团队成员可见性），不用 assertCanOperateOn 代替
    const scopeUser: ScopeUser = { id: targetId, roles: identity.roles, dataScopes: identity.dataScopes, accessCodes: [...effectiveCodes] };
    const qb = this.exampleRepo.createQueryBuilder('t')
      .select('t.id', 'id')
      .where('t.id = :recordId AND t.deleted_at IS NULL', { recordId: row.id });
    buildDataScope(qb, 't', scopeUser, RECORD_EXPLAINABLE_SCOPE_KEY, undefined, undefined, exampleMemberScopeVisibility('t', scopeUser));
    const inScope = !!(await qb.getRawOne());
    // 团队成员判定与运行时 isParticipant 钩子同口径：目标用户在成员表中即参与者
    const isParticipant = (await this.exampleRepo.manager.getRepository(ExampleItemMember).count({ where: { itemId: row.id, userId: targetId } })) > 0;

    // 本人/他人开关裁决：复用 data-scope 的 evaluateOperationSwitch（与运行时守卫同一核心）
    const switchVerdict = (operation: 'view' | 'edit' | 'delete') =>
      evaluateOperationSwitch({ ownerId: row.ownerId ?? null }, scopeUser, RECORD_EXPLAINABLE_SCOPE_KEY, operation, undefined, isParticipant);
    const mapVerdict = (verdict: ReturnType<typeof switchVerdict>): { ok: boolean; reason: ExplainReason } | 'no_owner' => {
      if (verdict.allowed) return { ok: true, reason: verdict.reason === 'participant' ? EXPLAIN_REASONS.RECORD_PARTICIPANT : EXPLAIN_REASONS.ADMIN_EXCEPTION };
      if (verdict.reason === 'no_owner') return 'no_owner';
      if (verdict.reason === 'others_permission_missing') return { ok: false, reason: EXPLAIN_REASONS.OPERATION_PERMISSION_MISSING };
      return { ok: false, reason: verdict.reason === 'self_switch_off' ? EXPLAIN_REASONS.SELF_SWITCH_OFF : EXPLAIN_REASONS.OTHERS_SWITCH_OFF };
    };

    const evaluations: RecordActionEvaluation[] = EXPLAIN_ACTIONS.map((action) => {
      const code = ACTION_PERMISSION_CODES[action];
      if (!effectiveCodes.has(code)) {
        return denied(action, [EXPLAIN_REASONS.OPERATION_PERMISSION_MISSING], `缺少操作权限码 ${code}（按当前角色授权，重新登录后生效）`);
      }
      if (!inScope) {
        return denied(action, [EXPLAIN_REASONS.RECORD_NOT_FOUND], '记录不在该用户的共同数据范围内（本人/指定用户/指定部门子树/团队成员口径）');
      }
      if (action === 'list') {
        return allowed(action, [], '记录落入列表共同范围，列表可见（列表可见不代表可查看详情）');
      }
      const view = mapVerdict(switchVerdict('view'));
      if (view === 'no_owner') {
        return denied(action, [EXPLAIN_REASONS.NO_OWNER_RECORD], '记录无归属人，仅系统管理员可操作');
      }
      if (action === 'detail' || action === 'export') {
        if (!view.ok) return denied(action, [view.reason], view.reason === EXPLAIN_REASONS.SELF_SWITCH_OFF ? '查看本人单据开关已关闭' : '查看他人单据开关已关闭');
        if (view.reason === EXPLAIN_REASONS.RECORD_PARTICIPANT) {
          return allowed(action, [view.reason], action === 'export' ? '该用户为此单据团队成员，且具备导出权限码（导出使用详情查看口径）' : '该用户为此单据团队成员：详情、履历与附件按查看口径可见');
        }
        return allowed(action, [], action === 'export' ? '列表共同范围且查看详情开关开启（导出使用详情查看开关）' : '共同范围内且查看开关开启');
      }
      const op = mapVerdict(switchVerdict(action === 'update' ? 'edit' : 'delete'));
      if (op === 'no_owner') {
        return denied(action, [EXPLAIN_REASONS.NO_OWNER_RECORD], '记录无归属人，仅系统管理员可操作');
      }
      if (!op.ok) {
        if (op.reason === EXPLAIN_REASONS.OPERATION_PERMISSION_MISSING) {
          return denied(action, [op.reason], `缺少操作他人记录的权限 ${otherRecordPermission(RECORD_EXPLAINABLE_SCOPE_KEY, action === 'update' ? 'edit' : 'delete')}`);
        }
        return denied(action, [op.reason], op.reason === EXPLAIN_REASONS.SELF_SWITCH_OFF ? `编辑/删除本人单据的开关已关闭（${action}）` : `编辑/删除他人单据的开关已关闭（${action}）`);
      }
      if (action === 'update' && !view.ok) {
        return denied(action, [EXPLAIN_REASONS.EDIT_REQUIRES_VIEW], '编辑附加查看资格：编辑开关开启但查看开关不满足');
      }
      const memberOperate = op.reason === EXPLAIN_REASONS.RECORD_PARTICIPANT || view.reason === EXPLAIN_REASONS.RECORD_PARTICIPANT;
      const reasons: ExplainReason[] = [ ...(memberOperate ? [EXPLAIN_REASONS.RECORD_PARTICIPANT] : []), ...(action === 'update' ? [EXPLAIN_REASONS.OPTIMISTIC_LOCK] : []) ];
      return allowed(action, reasons, action === 'update'
        ? memberOperate
          ? '该用户为此单据团队成员：按角色权限码直接可编辑；并发修改以版本乐观锁裁决，内容过期需刷新后重试'
          : '允许编辑；并发修改以版本乐观锁裁决，内容过期需刷新后重试'
        : memberOperate
          ? '该用户为此单据团队成员：按角色权限码可直接删除（删除进入两阶段回收站流程）'
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
