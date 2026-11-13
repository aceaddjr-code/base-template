-- 可见范围收敛：新增他人操作与回收站动作权限码。此补丁不变更表结构。
-- 顺序：备份 menus、role_menus、users、user_data_scopes 及目标表；停止授权写入；
-- 在隔离库执行本补丁并验证；维护窗口执行后配套发布前后端，所有用户重新登录。
-- 不向普通角色自动授权。存量范围的旧限制继续执行，管理员重新保存该用户范围后采用新规则。
-- 回滚：暂停访问，回退应用，按备份撤销本补丁新增的权限节点及关联；
-- 若发布期间已重新保存可见范围，需要用备份核对并恢复该用户旧限制，避免旧版误用新的兼容值。
-- 授权恢复后递增受影响用户的 token_version，再开放访问。禁止把版本恢复成更小的历史值。

START TRANSACTION;
DROP TEMPORARY TABLE IF EXISTS scoped_actions_20261109;
CREATE TEMPORARY TABLE scoped_actions_20261109 (
  path VARCHAR(200) NOT NULL,
  permission VARCHAR(100) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT NOT NULL
);
INSERT INTO scoped_actions_20261109 (path, permission, name, sort) VALUES
('/examples/items', 'example-items:update-others', '编辑他人记录', 20),
('/examples/items', 'example-items:delete-others', '删除他人记录', 21),
('/system/attachments', 'attachments:delete-others', '删除他人文件', 22),
('/system/recycle-bin', 'recycle-bin:restore', '恢复本人记录', 23),
('/system/recycle-bin', 'recycle-bin:purge', '彻底删除本人记录', 24),
('/system/recycle-bin', 'recycle-bin:restore-others', '恢复他人记录', 25),
('/system/recycle-bin', 'recycle-bin:purge-others', '彻底删除他人记录', 26);

INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, target.name, 'button', target.permission, target.sort, 1
FROM scoped_actions_20261109 target
JOIN (
  SELECT path, MIN(id) AS id
  FROM menus WHERE type = 'menu' AND status = 1 AND deleted_at IS NULL
  GROUP BY path
) parent ON parent.path = target.path
WHERE NOT EXISTS (SELECT 1 FROM menus existing WHERE existing.permission = target.permission);

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id
FROM roles r
JOIN menus m ON m.type = 'button' AND m.status = 1 AND m.deleted_at IS NULL
JOIN scoped_actions_20261109 target ON m.permission = target.permission
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);

UPDATE users SET token_version = token_version + 1 WHERE deleted_at IS NULL;
DROP TEMPORARY TABLE scoped_actions_20261109;
COMMIT;
