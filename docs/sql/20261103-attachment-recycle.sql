-- 在 20261103-recycle-bin.sql 后执行。上线前备份数据库与附件目录。
-- 历史已删除文件不补录；仅此功能启用后独立删除的文件进入回收站。
CREATE TABLE IF NOT EXISTS attachment_recycle (
  attachment_id INT NOT NULL PRIMARY KEY,
  deleted_by INT NOT NULL,
  actor_name VARCHAR(50) NOT NULL,
  deleted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  state VARCHAR(20) NOT NULL DEFAULT 'deleted'
) ENGINE=InnoDB;
-- 回滚前先停止服务，使用升级前数据库和附件备份恢复；直接删除此表会丢失回收站索引。
