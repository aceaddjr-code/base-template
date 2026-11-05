-- 第五批（通知可靠性与实时反馈）任务 01/02：outbox 表与 notifications 来源唯一键。
-- 发布顺序：先库 -> 后端（生产者+投递器+SSE）-> 前端；回退先停投递器/生产者，保留本表与唯一键。
-- 幂等可重复执行；旧通知 source_key 为 NULL（兼容已读状态），不补发历史。

CREATE TABLE IF NOT EXISTS notification_outbox (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  event_id varchar(64) NOT NULL COMMENT '业务事件标识（example_events.id）',
  recipient_id int NOT NULL COMMENT '接收人（新负责人）',
  type varchar(50) NOT NULL COMMENT '通知类型（owner-changed）',
  biz_type varchar(50) NULL COMMENT '关联记录类型',
  biz_id int NULL COMMENT '关联单据 ID',
  title varchar(200) NOT NULL COMMENT '最小文本标题',
  content text NULL COMMENT '最小文本内容（不含业务正文）',
  status varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/delivered/failed/skipped',
  attempts int NOT NULL DEFAULT 0 COMMENT '已尝试次数',
  next_attempt_at datetime NULL COMMENT '下次重试时刻（服务器时间）',
  lease_expires_at datetime NULL COMMENT '投递租约到期（60s）',
  lease_owner varchar(100) NULL COMMENT '持有者 host:pid',
  last_error varchar(500) NULL COMMENT '脱敏错误',
  delivered_notification_id int NULL COMMENT '落库通知 ID（幂等证据）',
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uniq_outbox_delivery (event_id, recipient_id, type),
  KEY idx_outbox_dispatch (status, next_attempt_at, lease_expires_at)
) COMMENT='通知待投递（第五批 outbox）';

SET @notif_src = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='source_key'),
  'SELECT ''source_key 已存在''', 'ALTER TABLE notifications ADD COLUMN source_key varchar(120) NULL COMMENT ''来源唯一键 type:event_id:recipient_id，旧数据 NULL''');
PREPARE notif_stmt FROM @notif_src;
EXECUTE notif_stmt;
DEALLOCATE PREPARE notif_stmt;

SET @notif_idx = IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND INDEX_NAME='uniq_notif_source'),
  'SELECT ''uniq_notif_source 已存在''', 'CREATE UNIQUE INDEX uniq_notif_source ON notifications (source_key)');
PREPARE notif_idx_stmt FROM @notif_idx;
EXECUTE notif_idx_stmt;
DEALLOCATE PREPARE notif_idx_stmt;

-- 核对：outbox 唯一键与领取索引、notifications 来源唯一键在位
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND (
  (TABLE_NAME='notification_outbox' AND INDEX_NAME IN ('uniq_outbox_delivery','idx_outbox_dispatch')) OR
  (TABLE_NAME='notifications' AND INDEX_NAME='uniq_notif_source'))
ORDER BY TABLE_NAME, INDEX_NAME;

-- 回滚：提交前 ROLLBACK；提交后先停投递器与生产者，确认无需补发后
-- DROP TABLE notification_outbox; ALTER TABLE notifications DROP INDEX uniq_notif_source, DROP COLUMN source_key;
-- 已投递站内信与已读状态保留；不清表重播。
