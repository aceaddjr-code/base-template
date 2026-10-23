-- F08 附件管理：为既有库补齐"附件管理"菜单、admin 角色授权和操作日志模块字典项。
-- 无表结构变更（attachments 由代码 synchronize/结构 SQL 建表）；不写附件数据。
-- 执行前备份 menus / role_menus / sys_dict_types / sys_dict_items 并记录前后差异；在停用管理写入的维护窗口执行。
-- 仅补缺失项；已有菜单（含手工停用、软删除）、角色授权、字典项不覆盖、不复活。
START TRANSACTION;

INSERT INTO menus (parent_id, name, path, icon, type, sort, status)
SELECT m.id, '附件管理', '/system/attachments', NULL, 'menu', 100, 1
FROM menus m
WHERE m.path = '/system' AND m.type = 'menu' AND m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus x WHERE x.path = '/system/attachments' AND x.deleted_at IS NULL);

INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, x.id
FROM roles r
CROSS JOIN (SELECT id FROM menus WHERE path = '/system/attachments' AND deleted_at IS NULL) x
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = x.id
  );

INSERT INTO sys_dict_items (type_id, label, value, sort, status)
SELECT t.id, '附件管理', 'attachments', 0, 1
FROM sys_dict_types t
WHERE t.code = 'log_entity_type' AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys_dict_items i
    WHERE i.type_id = t.id AND i.value = 'attachments' AND i.deleted_at IS NULL
  );

COMMIT;

-- 核对：菜单/授权各应至少一行；字典一行
SELECT m.id AS menu_id, m.path, m.status, rm.role_id
FROM menus m
LEFT JOIN role_menus rm ON rm.menu_id = m.id
WHERE m.path = '/system/attachments' AND m.deleted_at IS NULL;

SELECT i.value, i.label, i.status
FROM sys_dict_types t JOIN sys_dict_items i ON i.type_id = t.id
WHERE t.code = 'log_entity_type' AND i.value = 'attachments';

-- 回滚：提交前用 ROLLBACK；提交后按执行前备份和本次新增 ID 定向恢复相关表。
-- 不按 path/value 全量删除，不覆盖实施后其他管理员修改；若新菜单已被移入其他目录或另配授权，先核对再处理。
