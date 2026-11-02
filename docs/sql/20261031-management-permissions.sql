-- 公告、字典、日志、附件的 16 项管理操作权限；仅数据补丁，无表结构变更。
-- 执行顺序：此前适用补丁 -> 本补丁 -> 同步发布前后端 -> 管理员重新登录并按需分配。
-- 执行前停止管理写入，备份 menus / role_menus / users，记录本次新增 ID。
-- 只补缺失节点；已有同路由/权限码（含停用、软删除）不覆盖、不复活。
-- 不向普通角色自动授权；附件管理旧授权需管理员重新细分，单据内文件不依赖这些权限。
DROP TEMPORARY TABLE IF EXISTS management_permissions_20261031;
CREATE TEMPORARY TABLE management_permissions_20261031 (
  path varchar(200) NOT NULL,
  permission varchar(100) PRIMARY KEY,
  name varchar(50) NOT NULL,
  sort int NOT NULL
);
INSERT INTO management_permissions_20261031 (path, permission, name, sort) VALUES
('/system/announcements', 'announcements:view', '查看', 1),
('/system/announcements', 'announcements:create', '新增', 2),
('/system/announcements', 'announcements:update', '编辑', 3),
('/system/announcements', 'announcements:publish', '发布', 4),
('/system/announcements', 'announcements:withdraw', '撤回', 5),
('/system/announcements', 'announcements:delete', '删除', 6),
('/system/dict', 'dicts:view', '查看', 1),
('/system/dict', 'dicts:create', '新增', 2),
('/system/dict', 'dicts:update', '编辑', 3),
('/system/dict', 'dicts:delete', '删除', 4),
('/system/logs', 'system-logs:view', '查看', 1),
('/system/attachments', 'attachments:view', '查看', 1),
('/system/attachments', 'attachments:upload', '上传', 2),
('/system/attachments', 'attachments:download', '下载', 3),
('/system/attachments', 'attachments:delete', '删除', 4),
('/system/attachments', 'attachments:cleanup', '清理过期临时附件', 5);

START TRANSACTION;

-- 补齐缺失的页面；既有停用/软删除节点留给管理员核对，不另建同路由节点。
INSERT INTO menus (parent_id, name, path, type, sort, status)
SELECT parent.id, page.name, page.path, 'menu', page.sort, 1
FROM menus parent
JOIN (
  SELECT '系统公告' AS name, '/system/announcements' AS path, 99 AS sort
  UNION ALL SELECT '数据字典', '/system/dict', 94
  UNION ALL SELECT '操作日志', '/system/logs', 95
  UNION ALL SELECT '附件管理', '/system/attachments', 100
) page
WHERE parent.path = '/system' AND parent.type = 'menu' AND parent.status = 1 AND parent.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.path = page.path);

INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, target.name, 'button', target.permission, target.sort, 1
FROM management_permissions_20261031 target
JOIN menus parent ON parent.path = target.path AND parent.type = 'menu'
  AND parent.status = 1 AND parent.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM menus existing WHERE existing.permission = target.permission);

-- admin 为系统管理例外；其余角色需显式分配。已有授权不重复写入。
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, button.id
FROM roles r
JOIN menus button ON button.type = 'button' AND button.status = 1 AND button.deleted_at IS NULL
JOIN management_permissions_20261031 target ON target.permission = button.permission
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = button.id);

-- 管理员的权限码缓存以 tokenVersion 为键；使主角色或附加角色为 admin 的旧会话失效。
-- 每次执行都会递增这些账号版本；重复执行需要管理员再次登录。
UPDATE users u SET u.token_version = u.token_version + 1
WHERE u.deleted_at IS NULL AND (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
);

COMMIT;

-- 核对必须返回 16 项、各一条启用节点且 parent_path 与 expected_path 相同。
-- 若缺失、重复、停用、软删除或挂错页面，先由管理员核对修复，再启用相关功能。
SELECT target.permission, target.path AS expected_path, parent.path AS parent_path,
  button.id, button.status, button.deleted_at
FROM management_permissions_20261031 target
LEFT JOIN menus button ON button.permission = target.permission
LEFT JOIN menus parent ON parent.id = button.parent_id
ORDER BY target.path, target.sort;

DROP TEMPORARY TABLE management_permissions_20261031;

-- 回滚：提交前 ROLLBACK；提交后先回退配套前后端代码，再按执行前备份及新增 ID
-- 定向移除本次新增 role_menus / menus。不要按权限码批量删除，以免删除既有或后续授权。
-- 不降低 token_version；回退后重新登录即可，避免重新启用已失效的旧会话。
