-- 第二批（权限效果解释）任务 01：用户管理页新增「权限效果」诊断动作权限。
-- 仅数据补丁，无表结构变更；端点由本批任务 02 实现后发布，本补丁不提前开放接口。
-- 执行顺序：此前适用补丁 -> 停止管理写入，备份 menus / role_menus / users -> 隔离库验证
-- -> 维护窗口执行 -> 配套发布前后端 -> 管理员重新登录。
-- 权限节点按权限码判重，不覆盖、不复活已有节点（含停用、软删除）；不向普通角色自动授权。
-- 重复执行安全，但每次都会递增 admin 角色用户的 token_version，需重新登录。

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS permission_explain_20261104;
CREATE TEMPORARY TABLE permission_explain_20261104 (
  path VARCHAR(200) NOT NULL,
  permission VARCHAR(100) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT NOT NULL
);
INSERT INTO permission_explain_20261104 (path, permission, name, sort) VALUES
('/system/users', 'users:permission-explain', '权限效果', 3);

-- 用户管理页缺失时先补页面（真实库应已存在；同路径含软删除即视为已存在，不复活）。
INSERT INTO menus (parent_id, name, path, type, sort, status)
SELECT parent.id, '用户管理', '/system/users', 'menu', 91, 1
FROM menus parent
WHERE parent.path = '/system' AND parent.type = 'menu' AND parent.status = 1 AND parent.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.path = '/system/users');

INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, target.name, 'button', target.permission, target.sort, 1
FROM permission_explain_20261104 target
JOIN menus parent ON parent.path = target.path AND parent.type = 'menu'
  AND parent.status = 1 AND parent.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM menus existing WHERE existing.permission = target.permission);

-- admin 为系统管理例外；其余角色需显式分配（UserController 类级 admin 边界保留）。
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, button.id
FROM roles r
JOIN menus button ON button.type = 'button' AND button.status = 1 AND button.deleted_at IS NULL
JOIN permission_explain_20261104 target ON target.permission = button.permission
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = button.id);

-- 使 admin 角色旧会话失效，重新登录获取新权限码缓存。
UPDATE users u SET u.token_version = u.token_version + 1
WHERE u.deleted_at IS NULL AND (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
);

COMMIT;

-- 核对：必须返回 1 项启用按钮且挂在 /system/users 下。
SELECT target.permission, target.path AS expected_path, parent.path AS parent_path,
  button.id, button.status, button.deleted_at
FROM permission_explain_20261104 target
LEFT JOIN menus button ON button.permission = target.permission
LEFT JOIN menus parent ON parent.id = button.parent_id
ORDER BY target.sort;

DROP TEMPORARY TABLE IF EXISTS permission_explain_20261104;

-- 回滚：提交前 ROLLBACK；提交后先回退配套前后端代码，再按执行前备份与新增 ID 定向移除
-- 本次新增 role_menus / menus（不按权限码批量删除）；不回降 token_version，重新登录即可。
