import type { ScopeExtraVisibility, ScopeUser } from '../../common/utils/data-scope';
import { getUserId } from '../../common/utils/service-helpers';

/** 成员子表名：本文件刻意不反向 import example.service（那会与 example.service → 本工厂构成模块环） */
const EXAMPLE_ITEM_MEMBERS_TABLE = 'example_item_members';

/**
 * 团队成员可见性（示例模块业务规则）：当前用户在单据团队成员表中时，该单据与共同范围 OR 叠加可见。
 * 供 CrudOptions.extraVisibility、回收站范围查询与权限解释服务共用——可见性口径只写这一份。
 * 只描述 example-items 一个 scopeKey，调用方按各自 alias 传入。
 * 子查询别名 m 未注册进 QueryBuilder，列名手写蛇形（与 docs/sql 补丁一致）。
 * 不 import 任何 Nest provider / 模块内服务：auth 模块的解释服务可安全引用，无模块环。
 */
export function exampleMemberScopeVisibility(alias: string, user?: ScopeUser | null): ScopeExtraVisibility | null {
  const uid = getUserId(user);
  if (uid == null) return null;
  return {
    sql: `EXISTS (SELECT 1 FROM ${EXAMPLE_ITEM_MEMBERS_TABLE} m WHERE m.item_id = ${alias}.id AND m.user_id = :scopeMemberUid AND m.deleted_at IS NULL)`,
    params: { scopeMemberUid: uid },
  };
}
