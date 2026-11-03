-- 执行顺序：先执行 20261102 的示例字段、附件相关补丁，再执行本文件，最后部署前后端。
-- 执行前备份数据库及私有附件目录。历史已删单据不补录。
CREATE TABLE IF NOT EXISTS example_recycle (
  item_id INT NOT NULL PRIMARY KEY,
  attachment_ids JSON NOT NULL,
  deleted_by INT NOT NULL,
  actor_name VARCHAR(50) NOT NULL,
  deleted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  state VARCHAR(20) NOT NULL DEFAULT 'deleted'
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS example_reserved_numbers (
  doc_no VARCHAR(32) NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
SET @has_recycle_held = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attachments' AND column_name = 'recycle_held');
SET @ddl = IF(@has_recycle_held = 0, 'ALTER TABLE attachments ADD COLUMN recycle_held TINYINT NOT NULL DEFAULT 0 COMMENT ''回收站保留''', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
INSERT INTO menus (name, parent_id, path, type, status, sort)
SELECT '回收站', id, '/system/recycle-bin', 'menu', 1, 2 FROM menus
WHERE path = '/collaboration' AND NOT EXISTS (SELECT 1 FROM menus WHERE path = '/system/recycle-bin');
INSERT IGNORE INTO role_menus (role_id, menu_id)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m
WHERE m.path IN ('/collaboration', '/system/recycle-bin');
-- 回滚：先停服务并完整恢复部署前数据库及附件备份，再回滚应用。
-- 禁止直接 DROP 回收站表或部署旧清理任务：会丢失保留依据并清理仍可恢复的附件。
-- 编号占用表必须永久保留；彻底删除不具备逐条回滚能力。
