-- 账号安全闭环（第一批）任务 01：用户待改密字段、登录限流计数表、用户管理两项操作权限。
-- 执行顺序：完成此前适用补丁 -> 维护窗口停止登录流量与管理写入 -> 本补丁 -> 配套发布
-- 前后端（旧后端不认识待改密约束，禁止新旧实例混跑）-> 管理员重新登录。
-- 执行前备份 users / menus / role_menus；本补丁不修改任何存量密码哈希与 token_version 含义，
-- 存量用户 must_change_password 默认 0（行为不变）。
-- 权限节点按权限码判重，不覆盖、不移动、不复活已有节点（含停用、软删除）；
-- 不向普通角色自动授权。重复执行安全，但每次都会递增 admin 角色用户的 token_version，需重新登录。

-- 1. users 表两列（DDL 隐式提交，不能依赖 ROLLBACK 撤销；逐列判重可重复执行）。
SET @acct_ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='must_change_password'),
  'SELECT ''must_change_password 已存在''', 'ALTER TABLE users ADD COLUMN must_change_password TINYINT NOT NULL DEFAULT 0 COMMENT ''登录后必须修改密码（0/1）''');
PREPARE acct_stmt FROM @acct_ddl;
EXECUTE acct_stmt;
DEALLOCATE PREPARE acct_stmt;
SET @acct_ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='temporary_password_expires_at'),
  'SELECT ''temporary_password_expires_at 已存在''', 'ALTER TABLE users ADD COLUMN temporary_password_expires_at DATETIME NULL COMMENT ''临时密码到期时间，NULL=非临时''');
PREPARE acct_stmt FROM @acct_ddl;
EXECUTE acct_stmt;
DEALLOCATE PREPARE acct_stmt;

-- 2. 登录限流计数表：主键桶键支持原子额度预占（INSERT ... ON DUPLICATE KEY UPDATE），
--    updated_at 索引支持有界批量过期清理；与后端实体 login-attempt-counter.entity.ts 同构。
CREATE TABLE IF NOT EXISTS login_attempt_counters (
  bucket_key VARCHAR(150) NOT NULL COMMENT '限流桶键：ip:/acct:/acct:pending:',
  window_start DATETIME NULL COMMENT '当前固定窗口起点，兼作窗口代次',
  window_seconds INT NOT NULL DEFAULT 0 COMMENT '窗口长度（秒）：IP 60 / 账号 900',
  attempt_count INT NOT NULL DEFAULT 0 COMMENT '窗口内尝试计数',
  fail_streak INT NOT NULL DEFAULT 0 COMMENT '连续失败次数',
  retry_after DATETIME NULL COMMENT '失败退避到期时间，NULL=无退避',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (bucket_key),
  KEY idx_login_attempt_counters_updated_at (updated_at)
) COMMENT='登录尝试限流计数（账号安全第一批）';

START TRANSACTION;

-- 3. 用户管理页下两项操作权限：重置密码、退出全部登录。仅补缺失节点；页面缺失时先补页面
--    （真实库应已存在；同路径节点含软删除即视为已存在，不复活）。
DROP TEMPORARY TABLE IF EXISTS account_security_permissions_20261104;
CREATE TEMPORARY TABLE account_security_permissions_20261104 (
  path VARCHAR(200) NOT NULL,
  permission VARCHAR(100) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  sort INT NOT NULL
);
INSERT INTO account_security_permissions_20261104 (path, permission, name, sort) VALUES
('/system/users', 'users:reset-password', '重置密码', 1),
('/system/users', 'users:revoke-sessions', '退出全部登录', 2);

INSERT INTO menus (parent_id, name, path, type, sort, status)
SELECT parent.id, '用户管理', '/system/users', 'menu', 91, 1
FROM menus parent
WHERE parent.path = '/system' AND parent.type = 'menu' AND parent.status = 1 AND parent.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus m WHERE m.path = '/system/users');

INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, target.name, 'button', target.permission, target.sort, 1
FROM account_security_permissions_20261104 target
JOIN menus parent ON parent.path = target.path AND parent.type = 'menu'
  AND parent.status = 1 AND parent.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM menus existing WHERE existing.permission = target.permission);

-- admin 为系统管理例外；其余角色需显式分配（本批保留 UserController 类级 admin 边界）。
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, button.id
FROM roles r
JOIN menus button ON button.type = 'button' AND button.status = 1 AND button.deleted_at IS NULL
JOIN account_security_permissions_20261104 target ON target.permission = button.permission
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = button.id);

-- 权限码缓存以 tokenVersion 为键；使主角色或附加角色为 admin 的旧会话失效（重新登录）。
UPDATE users u SET u.token_version = u.token_version + 1
WHERE u.deleted_at IS NULL AND (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
);

COMMIT;

-- 核对：必须返回 2 项、各一条启用按钮且挂在 /system/users 下。
SELECT target.permission, target.path AS expected_path, parent.path AS parent_path,
  button.id, button.status, button.deleted_at
FROM account_security_permissions_20261104 target
LEFT JOIN menus button ON button.permission = target.permission
LEFT JOIN menus parent ON parent.id = button.parent_id
ORDER BY target.sort;

DROP TEMPORARY TABLE IF EXISTS account_security_permissions_20261104;

-- 回滚：
-- 一、未启用（配套代码尚未发布）：按补丁逆序，先按执行前备份与新增 ID 定向移除本次新增
--    role_menus / menus（不要按权限码批量删除），再 DROP TABLE login_attempt_counters，
--    最后确认无依赖后 ALTER TABLE users DROP COLUMN must_change_password,
--    DROP COLUMN temporary_password_expires_at。token_version 不回降，重新登录即可。
-- 二、已启用（新代码已发布且待改密账号存在）：禁止直接回滚到不检查待改密标志的旧服务。
--    先停止登录流量 -> 撤销相关会话（递增 token_version）-> 逐个处置仍有效的临时密码与
--    待改密账号（完成改密或明确废弃）-> 回退前后端代码 -> 验证 -> 恢复流量。
--    用户数据和审计保留至确认回滚完成；删除表结构是最后一步。
