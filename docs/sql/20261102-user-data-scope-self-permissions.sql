-- 为共同数据范围补齐本人查看、编辑、删除开关；旧配置默认全部开启。
-- 先备份 user_data_scopes、user_data_scope_targets、users。
-- MySQL DDL 隐式提交，不能依赖 ROLLBACK 撤销；每列均可重复执行。
SET @scope_ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_data_scopes' AND COLUMN_NAME='view_self'),
  'SELECT ''view_self 已存在''', 'ALTER TABLE user_data_scopes ADD COLUMN view_self TINYINT NOT NULL DEFAULT 1 COMMENT ''查看本人单据详情（0/1）''');
PREPARE scope_stmt FROM @scope_ddl;
EXECUTE scope_stmt;
DEALLOCATE PREPARE scope_stmt;
SET @scope_ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_data_scopes' AND COLUMN_NAME='edit_self'),
  'SELECT ''edit_self 已存在''', 'ALTER TABLE user_data_scopes ADD COLUMN edit_self TINYINT NOT NULL DEFAULT 1 COMMENT ''编辑本人单据（0/1）''');
PREPARE scope_stmt FROM @scope_ddl;
EXECUTE scope_stmt;
DEALLOCATE PREPARE scope_stmt;
SET @scope_ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_data_scopes' AND COLUMN_NAME='delete_self'),
  'SELECT ''delete_self 已存在''', 'ALTER TABLE user_data_scopes ADD COLUMN delete_self TINYINT NOT NULL DEFAULT 1 COMMENT ''删除本人单据（0/1）''');
PREPARE scope_stmt FROM @scope_ddl;
EXECUTE scope_stmt;
DEALLOCATE PREPARE scope_stmt;

-- 回滚：停止写入，备份新配置；停用任一本人开关为0的账号并递增 token_version，
-- 避免旧代码恢复“本人恒允许”。回退代码后逐个重新确认授权，再恢复账号。
-- 保留新增列便于恢复；确认无依赖后才执行：
-- ALTER TABLE user_data_scopes DROP COLUMN view_self, DROP COLUMN edit_self, DROP COLUMN delete_self;
