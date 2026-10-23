-- 适用：仍具有 roles.data_scope、role_depts 和用户级范围表的旧版数据库。
-- 全新模板数据库不要执行。先备份，停写后在新代码启动前执行，升级期间禁用 synchronize。
-- 仅将未配置过用户级范围的账号迁移到显式配置；保留全部旧表和旧列以便回滚。
-- 回滚：提交前 ROLLBACK；提交后恢复执行前数据库备份和对应代码版本。

START TRANSACTION;

CREATE TEMPORARY TABLE template_scope_users AS
SELECT u.id AS user_id, u.dept_id, u.role_id,
       CASE
         WHEN r.data_scope = 'all' THEN 'all'
         WHEN r.data_scope IN ('dept', 'dept_and_child') AND u.dept_id IS NOT NULL THEN 'by_depts'
         WHEN r.data_scope = 'custom' AND EXISTS (
           SELECT 1 FROM role_depts rd WHERE rd.role_id = r.id AND rd.deleted_at IS NULL
         ) THEN 'by_depts'
         ELSE 'self'
       END AS scope_type,
       r.data_scope AS old_scope
FROM users u
LEFT JOIN roles r ON r.id = u.role_id AND r.deleted_at IS NULL AND r.status = 1
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_data_scopes s WHERE s.user_id = u.id);

INSERT INTO user_data_scopes
  (user_id, scope_key, scope_type, view_others, edit_others, delete_others, owner_id, created_by)
SELECT user_id, '__global__', scope_type, 1, IF(scope_type IN ('all', 'by_depts'), 1, 0), 0, user_id, user_id
FROM template_scope_users;

INSERT INTO user_data_scope_targets
  (user_data_scope_id, target_type, target_id, owner_id, created_by)
SELECT s.id, 'dept', t.dept_id, t.user_id, t.user_id
FROM template_scope_users t
JOIN user_data_scopes s ON s.user_id = t.user_id AND s.scope_key = '__global__'
WHERE t.old_scope IN ('dept', 'dept_and_child') AND t.dept_id IS NOT NULL;

INSERT INTO user_data_scope_targets
  (user_data_scope_id, target_type, target_id, owner_id, created_by)
SELECT DISTINCT s.id, 'dept', rd.dept_id, t.user_id, t.user_id
FROM template_scope_users t
JOIN user_data_scopes s ON s.user_id = t.user_id AND s.scope_key = '__global__'
JOIN role_depts rd ON rd.role_id = t.role_id AND rd.deleted_at IS NULL
WHERE t.old_scope = 'custom' AND t.scope_type = 'by_depts';

UPDATE users SET token_version = token_version + 1 WHERE deleted_at IS NULL;
DROP TEMPORARY TABLE template_scope_users;

COMMIT;
