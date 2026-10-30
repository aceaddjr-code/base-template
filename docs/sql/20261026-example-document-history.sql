-- 前置：已有 example_items（含 version）、users；先备份，在隔离库验证，再按发布流程执行。
-- 应用发布前执行本补丁；不修改既有事项，不补造历史。可重复执行。
CREATE TABLE IF NOT EXISTS example_events (
 id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id int NOT NULL,
 action varchar(20) NOT NULL,
 result varchar(20) NOT NULL,
 object_label varchar(100) NOT NULL,
 actor_id int NOT NULL,
 actor_name varchar(50) NOT NULL,
 occurred_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 source varchar(20) NOT NULL,
 request_id varchar(100) NULL,
 interaction_id varchar(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 batch_id varchar(36) NULL,
 `row_number` int NULL,
 version int NOT NULL,
 UNIQUE KEY uq_example_event_intent (actor_id, interaction_id),
 KEY ix_example_event_document (item_id, occurred_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS example_changes (
 id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
 event_id int NOT NULL,
 field_key varchar(50) NOT NULL,
 field_label varchar(50) NOT NULL,
 value_type varchar(20) NOT NULL,
 before_value json NULL,
 after_value json NULL,
 before_label text NULL,
 after_label text NULL,
 KEY ix_example_change_event (event_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- 不设到业务记录/人员/字典的级联外键。事件与差异只追加，不纳入平台审计清理。
-- 保留数据回滚：停用写入口，回退应用代码，保留以上两表及其数据；无需 DROP 或数据转换。
-- 重新发布应用时可直接继续采集。仅经明确授权、归档核对后才可另行制定删除历史的脚本。
