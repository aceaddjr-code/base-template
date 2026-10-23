-- F19 系统公告：为既有库补齐"系统公告"菜单、admin 角色授权和操作日志字典项。
-- 无表结构变更（announcements 由代码 synchronize/结构 SQL 建表）；不写公告数据。
-- 执行前备份 menus / role_menus / sys_dict_types / sys_dict_items 并记录前后差异；在停用管理写入的维护窗口执行。
-- 仅补缺失项；已有菜单（含手工停用、软删除）、角色授权、字典项不覆盖、不复活。
START TRANSACTION;

-- 1) 菜单：挂在"系统管理"目录下（/system）
INSERT INTO menus (parent_id, name, path, icon, type, sort, status)
SELECT m.id, '系统公告', '/system/announcements', NULL, 'menu', 99, 1
FROM menus m
WHERE m.path = '/system' AND m.type = 'menu' AND m.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus x WHERE x.path = '/system/announcements' AND x.deleted_at IS NULL);

-- 2) 授权 admin 角色（系统管理例外，与初始化种子一致；其他角色由管理员在角色管理中自行分配）
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, x.id
FROM roles r
CROSS JOIN (SELECT id FROM menus WHERE path = '/system/announcements' AND deleted_at IS NULL) x
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_menus rm
    WHERE rm.role_id = r.id AND rm.menu_id = x.id
  );

-- 3) 日志动作字典：publish/withdraw（仅补缺失）
INSERT INTO sys_dict_items (type_id, label, value, sort, status)
SELECT t.id, x.label, x.value, x.sort, 1
FROM sys_dict_types t
JOIN (
  SELECT '发布' AS label, 'publish' AS value, 70 AS sort
  UNION ALL SELECT '撤回', 'withdraw', 71
) x
WHERE t.code = 'log_action' AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys_dict_items i
    WHERE i.type_id = t.id AND i.value = x.value AND i.deleted_at IS NULL
  );

-- 4) 日志模块字典：system_announcements（仅补缺失）
INSERT INTO sys_dict_items (type_id, label, value, sort, status)
SELECT t.id, '系统公告', 'system_announcements', 0, 1
FROM sys_dict_types t
WHERE t.code = 'log_entity_type' AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys_dict_items i
    WHERE i.type_id = t.id AND i.value = 'system_announcements' AND i.deleted_at IS NULL
  );

COMMIT;

-- 核对：菜单/授权各应至少一行；字典各两行/一行
SELECT m.id AS menu_id, m.path, m.status, rm.role_id
FROM menus m
LEFT JOIN role_menus rm ON rm.menu_id = m.id
WHERE m.path = '/system/announcements' AND m.deleted_at IS NULL;

SELECT i.value, i.label, i.status
FROM sys_dict_types t JOIN sys_dict_items i ON i.type_id = t.id
WHERE t.code = 'log_action' AND i.value IN ('publish', 'withdraw');

SELECT i.value, i.label, i.status
FROM sys_dict_types t JOIN sys_dict_items i ON i.type_id = t.id
WHERE t.code = 'log_entity_type' AND i.value = 'system_announcements';

-- 回滚：提交前用 ROLLBACK；提交后按执行前备份和本次新增 ID 定向恢复相关表。
-- 不按 path/value 全量删除，不覆盖实施后其他管理员修改；若新菜单已被移入其他目录或另配授权，先核对再处理。
