/**
 * 部门子树查询的唯一口径（MySQL 8 WITH RECURSIVE，均排除软删除）。
 * 列表过滤谓词、用户列表筛选和部门防环校验共用这里，避免多处实现漂移。
 */

/** 根条件（如 "id = ?" 或 "id IN (:...ids)"）→ 完整递归查询文本，结果含根自身 */
export function deptSubtreeSelect(rootCond: string): string {
  return `WITH RECURSIVE dept_tree AS (
    SELECT id FROM departments WHERE ${rootCond} AND deleted_at IS NULL
    UNION ALL
    SELECT d.id FROM departments d
    INNER JOIN dept_tree dt ON d.parent_id = dt.id
    WHERE d.deleted_at IS NULL
  ) SELECT id FROM dept_tree`;
}

/** 列表过滤谓词：用户部门在子树内（users 表别名固定为 u） */
export function deptSubtreeIn(rootCond: string): string {
  return `u.dept_id IN (${deptSubtreeSelect(rootCond)})`;
}
