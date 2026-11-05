-- 第四批（导入预检查与错误文件）任务 01/02：导入会话与行结果表。
-- 仅新表，无存量迁移；旧导入履历（example_events）原样保留。
-- 执行顺序：此前适用补丁 -> 停止导入写入 -> 隔离库验证 -> 维护窗口执行 -> 配套发布前后端。
-- 表由实体 synchronize 在开发库自动建；本补丁服务存量库。幂等可重复执行。

CREATE TABLE IF NOT EXISTS example_import_sessions (
  id varchar(36) NOT NULL COMMENT '导入会话 ID（importId）',
  user_id int NOT NULL COMMENT '创建者（授权主体）',
  file_digest char(64) NOT NULL COMMENT 'SHA-256(文件)',
  file_name varchar(255) NOT NULL COMMENT '原文件名（展示用）',
  sheet_name varchar(100) NULL COMMENT '解析的首个数据工作表名',
  header_row_number int NULL COMMENT '表头行（1 起）',
  parse_version int NOT NULL COMMENT '解析版本',
  total_rows int NOT NULL COMMENT '数据行总数',
  valid_rows int NOT NULL COMMENT '预检通过行数',
  status varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/processing/done/failed/expired',
  summary json NULL COMMENT 'done 后聚合：success/invalid/unprocessed',
  expires_at datetime NOT NULL COMMENT '会话有效期（预检+24h）',
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at datetime NULL,
  created_by int NULL,
  updated_by int NULL,
  owner_id int NULL,
  PRIMARY KEY (id),
  KEY idx_import_sessions_user (user_id, created_at),
  KEY idx_import_sessions_expiry (status, expires_at)
) COMMENT='示例事项导入会话（第四批）';

CREATE TABLE IF NOT EXISTS example_import_rows (
  id bigint AUTO_INCREMENT PRIMARY KEY,
  session_id varchar(36) NOT NULL COMMENT '关联会话',
  row_number int NOT NULL COMMENT '原始 Excel 行号（1 起，行唯一标识）',
  cell_refs json NULL COMMENT 'key->原始单元格坐标（报告/标红）',
  data json NOT NULL COMMENT '服务端保存的规范化行数据',
  status varchar(30) NOT NULL DEFAULT 'pending' COMMENT 'pending/success/invalid/infrastructure_error',
  error_code varchar(50) NULL COMMENT 'VALIDATION/PERMISSION/DICT/INFRASTRUCTURE/EXPIRED',
  error_message varchar(500) NULL COMMENT '可读原因（脱敏）',
  created_item_id int NULL COMMENT '成功单据 ID（幂等证据）',
  created_doc_no varchar(32) NULL COMMENT '成功单据编号',
  processed_at datetime NULL,
  created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uniq_import_session_row (session_id, row_number),
  KEY idx_import_rows_status (session_id, status)
) COMMENT='示例事项导入行结果（第四批）';

-- 核对：两表存在且唯一键在位
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('example_import_sessions','example_import_rows')
ORDER BY TABLE_NAME, INDEX_NAME;

-- 回滚：先停止确认入口并处理运行中会话（导出 pending/processing 清单留档防重），
-- 再 DROP TABLE example_import_rows, example_import_sessions。旧导入履历不受影响。
