-- 第六批（系统参数按需扩展）任务 01/02：参数修订号列与设置更新权限节点。
-- 幂等可重复执行；无存量数据迁移（revision 全局从 0 起算，首次更新递增）。
-- 发布顺序：先库 -> 后端 -> 前端；回退先关闭维护横幅（enabled=false）再协调回退，不清空参数表。

SET @settings_rev = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_settings' AND COLUMN_NAME='revision'),
  'SELECT ''revision 已存在''', 'ALTER TABLE sys_settings ADD COLUMN revision int NOT NULL DEFAULT 0 COMMENT ''全局参数修订号，任一更新递增（乐观并发）''');
PREPARE settings_rev_stmt FROM @settings_rev;
EXECUTE settings_rev_stmt;
DEALLOCATE PREPARE settings_rev_stmt;

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS settings_update_permission_20261105;
CREATE TEMPORARY TABLE settings_update_permission_20261105 (
  path VARCHAR(200) NOT NULL,
  permission VARCHAR(100) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT NOT NULL
);
INSERT INTO settings_update_permission_20261105 (path, permission, name, sort) VALUES
('/system/settings', 'system-settings:update', '修改系统参数', 1);

INSERT INTO menus (parent_id, name, path, type, sort, status)
SELECT parent.id, '系统参数', '/system/settings', 'menu', 96, 1
FROM menus parent
WHERE parent.path = '/system' AND parent.type = 'menu' AND parent.status = 1 AND parent.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.path = '/system/settings');

INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, target.name, 'button', target.permission, target.sort, 1
FROM settings_update_permission_20261105 target
JOIN menus parent ON parent.path = target.path AND parent.type = 'menu'
  AND parent.status = 1 AND parent.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM menus existing WHERE existing.permission = target.permission);

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, button.id
FROM roles r
JOIN menus button ON button.type = 'button' AND button.status = 1 AND button.deleted_at IS NULL
JOIN settings_update_permission_20261105 target ON target.permission = button.permission
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = button.id);

UPDATE users u SET u.token_version = u.token_version + 1
WHERE u.deleted_at IS NULL AND (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
);

COMMIT;

SELECT target.permission, target.path AS expected_path, parent.path AS parent_path,
  button.id, button.status, button.deleted_at
FROM settings_update_permission_20261105 target
LEFT JOIN menus button ON button.permission = target.permission
LEFT JOIN menus parent ON parent.id = button.parent_id
ORDER BY target.sort;

DROP TEMPORARY TABLE IF EXISTS settings_update_permission_20261105;

-- 回滚：提交前 ROLLBACK；提交后先在管理页关闭维护横幅，回退配套前后端，
-- 再按备份与新增 ID 定向移除本次节点/授权（不按权限码批量删）；
-- revision 列可保留（无害），确认无依赖后 ALTER TABLE sys_settings DROP COLUMN revision。
-- 参数取值不清空。
