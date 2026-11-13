import type { ScopeFlags, ScopeType } from '../../common/utils/data-scope';

/**
 * 权限效果解释共享契约：动作映射、reasonCodes 与分层裁决顺序。
 * 动作→权限码映射直接声明于此（list/detail→view、update→update、delete→delete、export→export，
 * 源自 CrudBaseController 的 CRUD_PERM_ACTION_MAP 与 @CrudPermPrefix 路由声明）。
 */

/** 单据记录诊断动作。 */
export const EXPLAIN_ACTIONS = ['list', 'detail', 'update', 'delete', 'export'] as const;
export type ExplainAction = (typeof EXPLAIN_ACTIONS)[number]
  | 'download' | 'documentDownload' | 'recycleDetail' | 'recycleDownload' | 'restore' | 'purge';

/** 动作 → 所需权限码（真实路由声明映射，见 action-map §1）。 */
export const ACTION_PERMISSION_CODES: Record<(typeof EXPLAIN_ACTIONS)[number], string> = {
  list: 'example-items:view',
  detail: 'example-items:view',
  update: 'example-items:update',
  delete: 'example-items:delete',
  export: 'example-items:export',
};

/** 单据记录级诊断的表单。 */
export const RECORD_EXPLAINABLE_SCOPE_KEY = 'example-items';

export const EXPLAIN_REASONS = {
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_MUST_CHANGE_PASSWORD: 'ACCOUNT_MUST_CHANGE_PASSWORD',
  OPERATION_PERMISSION_MISSING: 'OPERATION_PERMISSION_MISSING',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  SELF_SWITCH_OFF: 'SELF_SWITCH_OFF',
  OTHERS_SWITCH_OFF: 'OTHERS_SWITCH_OFF',
  NO_OWNER_RECORD: 'NO_OWNER_RECORD',
  EDIT_REQUIRES_VIEW: 'EDIT_REQUIRES_VIEW',
  OPTIMISTIC_LOCK: 'OPTIMISTIC_LOCK',
  ADMIN_EXCEPTION: 'ADMIN_EXCEPTION',
  /** 记录参与者（示例事项团队成员）口径：可见性由成员身份提供，操作由角色权限码决定 */
  RECORD_PARTICIPANT: 'RECORD_PARTICIPANT',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  RECORD_STATE_BLOCKED: 'RECORD_STATE_BLOCKED',
  RECYCLE_SWITCH_OFF: 'RECYCLE_SWITCH_OFF',
} as const;

export type ExplainReason = (typeof EXPLAIN_REASONS)[keyof typeof EXPLAIN_REASONS];

export interface PermissionSourceRole {
  roleId: number;
  roleCode: string;
  roleName: string;
  roleEnabled: boolean;
}

export interface OperationPermissionExplanation {
  action: ExplainAction;
  permissionCode: string;
  effective: boolean;
  sources: PermissionSourceRole[];
  adminException: boolean;
}

export interface DataScopeExplanation {
  scopeType: ScopeType | 'fallback_self';
  flags: ScopeFlags;
  targetUsers?: Array<{ id: number; label: string }>;
  targetDepts?: Array<{ id: number; label: string }>;
  description: string;
}

export interface RecordActionEvaluation {
  action: ExplainAction;
  result: 'allowed' | 'denied' | 'unsupported';
  reasonCodes: ExplainReason[];
  readableReason: string;
}

export interface PermissionExplanationResponse {
  evaluatedAt: string;
  targetUserId: number;
  tokenVersion: number;
  configSource: {
    scopeKey: string;
    scopeFormLabel: string;
    configured: boolean;
    fallback: 'self_only' | null;
  };
  account: { status: 0 | 1; mustChangePassword: boolean };
  operationPermissions: OperationPermissionExplanation[];
  dataScope: DataScopeExplanation;
  recordEvaluation: RecordActionEvaluation[] | null;
  /** 诊断必要的归属信息；不含单据正文、附件与敏感字段。 */
  record?: {
    id: number;
    docNo: string | null;
    title: string;
    ownerId: number | null;
    ownerLabel: string | null;
    deleted: boolean;
  } | null;
}
