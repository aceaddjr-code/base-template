-- F40 示例事项类别：示例模块新增字典驱动字段 `category`（字典类型 item_category），并补齐字典选项（含一个停用项演示存量保留与回显）。
-- 结构变更：example_items 新增一列（开发环境由 synchronize 自动建列；生产执行本补丁）。
-- 执行前备份 example_items / sys_dict_types / sys_dict_items 并记录前后差异；在停用写入的维护窗口执行。
-- 幂等：列存在则跳过；字典仅补缺失项，不覆盖已有启停/软删除状态。
START TRANSACTION;

-- 1) 结构：example_items 增加 category 列（MySQL 8 支持原子 ADD COLUMN IF NOT EXISTS 语义需自行判断,这里用 information_schema 判断）
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'category'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE `example_items` ADD COLUMN `category` varchar(50) NULL COMMENT ''类别（字典 item_category）''',
  'SELECT ''category 列已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 字典类型 item_category（仅补缺失）
INSERT INTO sys_dict_types (code, name, status)
SELECT 'item_category', '事项类别', 1
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_types WHERE code = 'item_category' AND deleted_at IS NULL);

-- 3) 字典选项:类别甲/类别乙(启用)、旧类别(停用,演示存量停用值保留与回显)
INSERT INTO sys_dict_items (type_id, label, value, sort, status)
SELECT t.id, x.label, x.value, x.sort, x.status
FROM sys_dict_types t
JOIN (
  SELECT '类别甲' AS label, 'cat-a' AS value, 0 AS sort, 1 AS status
  UNION ALL SELECT '类别乙', 'cat-b', 1, 1
  UNION ALL SELECT '旧类别', 'cat-old', 2, 0
) x
WHERE t.code = 'item_category' AND t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys_dict_items i
    WHERE i.type_id = t.id AND i.value = x.value AND i.deleted_at IS NULL
  );

COMMIT;

-- 核对:列存在;字典三项
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'category';

SELECT i.value, i.label, i.status
FROM sys_dict_types t JOIN sys_dict_items i ON i.type_id = t.id
WHERE t.code = 'item_category' ORDER BY i.sort;

-- 回滚：提交前 ROLLBACK;提交后(1) ALTER TABLE example_items DROP COLUMN category(确认无业务数据后) (2) 按备份恢复字典两表。
-- 不删除示例行数据;若停用项已被业务引用,恢复启用状态即可,无需删数据。
