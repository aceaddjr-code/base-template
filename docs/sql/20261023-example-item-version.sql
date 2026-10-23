-- F06 示例事项乐观锁：example_items 新增 version 列（int NOT NULL DEFAULT 1）。
-- 开发环境由 synchronize 自动建列；生产/既有库执行本补丁。执行前备份 example_items 并停止写入。
-- 幂等：列已存在则跳过，可重复执行。
START TRANSACTION;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'version'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE `example_items` ADD COLUMN `version` int NOT NULL DEFAULT 1 COMMENT ''乐观锁版本（F06）''',
  'SELECT ''version 列已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

COMMIT;

-- 核对：列存在且默认 1。
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'version';

-- 回滚：提交前 ROLLBACK；提交后 ALTER TABLE `example_items` DROP COLUMN `version`（确认无依赖后执行）。
-- 存量行由 DEFAULT 1 补齐，不需要数据迁移；回滚后旧代码按最后写入胜出行为继续工作。
