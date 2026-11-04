import type { ScopeFlags, ScopeType } from '../../common/utils/data-scope';

/**
 * 权限效果解释（第二批）共享契约：动作映射与 reasonCodes 以
 * [.scratch/permission-explanation-phase2/action-map.md](../../../.scratch/permission-explanation-phase2/action-map.md)
 * 为唯一事实来源；本文件只承载类型与常量，不注册路由。
 */

/** 诊断动作全集（记录级仅 example-items；其余表单一律 unsupported）。 */
export const EXPLAIN_ACTIONS = ['list', 'detail', 'update', 'delete', 'export'] as const;
export type ExplainAction = (typeof EXPLAIN_ACTIONS)[number];

/** 动作 → 所需权限码（真实路由声明映射，见 action-map §1）。 */
export const ACTION_PERMISSION_CODES: Record<ExplainAction, string> = {
  list: 'example-items:view',
  detail: 'example-items:view',
  update: 'example-items:update',
  delete: 'example-items:delete',
  export: 'example-items:export',
};

/** 记录级诊断支持的 scopeKey；其余已注册表单只提供摘要。 */
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
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
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
