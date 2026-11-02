-- 示例事项单据化(2026-11-02):example_items 新增 单据编号 doc_no 与 备注 remark 两列,
-- 存量行回填编号(EX-yyyymmdd-<id>,按创建日期),并补「变更负责人」按钮权限节点(example-items:owner)。
-- 变更一:doc_no varchar(32) NULL,回填后建唯一索引(可空列允许多个 NULL,开发库 synchronize 与补丁互不冲突)。
-- 变更二:remark varchar(500) NULL。
-- 变更三:菜单「示例事项」下新增按钮节点「变更负责人」,仅授予 admin(系统管理例外);
--         普通角色由管理员在角色管理显式勾选,补丁不自动授权。
-- 执行顺序:停止单据写入 -> 本补丁 -> 同步发布后端 -> 前端 -> 管理员重新登录并按需配置角色。
-- 执行前备份 example_items / menus / role_menus / users 并记录新增 ID。
-- 前置确认:重复执行时列/索引已存在会跳过并提示,属预期;菜单按权限码判重,不覆盖已有节点。
-- 回填口径:EX-<created_at 日期>-<id 补零 3 位>。生成器按"末 3 位流水"取当日最大值,
--   单日新增超过 999 条时末 3 位空间会被占用(如 id 1000 末 3 位为 000),需人工核对该日编号;模板演示场景不会出现。

START TRANSACTION;

-- 1) 结构:doc_no 列(幂等)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'doc_no'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE `example_items` ADD COLUMN `doc_no` varchar(32) NULL COMMENT ''单据编号（唯一，系统生成）''',
  'SELECT ''doc_no 列已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 结构:remark 列(幂等)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'remark'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE `example_items` ADD COLUMN `remark` varchar(500) NULL COMMENT ''备注''',
  'SELECT ''remark 列已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 存量回填编号(含软删行:它们与在用行共用同一编号空间,回填后才便于追溯)
UPDATE example_items
SET doc_no = CONCAT('EX-', DATE_FORMAT(created_at, '%Y%m%d'), '-', LPAD(id, 3, '0'))
WHERE doc_no IS NULL;

-- 4) 唯一索引:按"doc_no 上已存在唯一索引"判重,兼容开发库 synchronize 自动建索引的命名
SET @idx_exists = (
  SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items'
    AND COLUMN_NAME = 'doc_no' AND NON_UNIQUE = 0
);
SET @ddl = IF(@idx_exists = 0,
  'ALTER TABLE `example_items` ADD UNIQUE INDEX `uk_example_items_doc_no` (`doc_no`)',
  'SELECT ''doc_no 唯一索引已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) 「变更负责人」按钮节点:挂在「示例事项」页下,排序取该页现有按钮之后;只补缺失
INSERT INTO menus (parent_id, name, type, permission, sort, status)
SELECT parent.id, '变更负责人', 'button', 'example-items:owner',
  (SELECT COALESCE(MAX(m.sort), 0) + 1 FROM menus m WHERE m.parent_id = parent.id AND m.deleted_at IS NULL), 1
FROM menus parent
WHERE parent.path = '/examples/items' AND parent.type = 'menu' AND parent.status = 1 AND parent.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM menus b WHERE b.permission = 'example-items:owner');

-- 6) admin 为系统管理例外;其余角色需在角色管理显式分配,已有授权不重复写入
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, button.id
FROM roles r
JOIN menus button ON button.type = 'button' AND button.status = 1 AND button.deleted_at IS NULL
  AND button.permission = 'example-items:owner'
WHERE r.code = 'admin' AND r.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = button.id);

-- 管理员权限码缓存以 tokenVersion 为键:使主角色或附加角色为 admin 的旧会话失效(重复执行会再次递增)
UPDATE users u SET u.token_version = u.token_version + 1
WHERE u.deleted_at IS NULL AND (
  EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.deleted_at IS NULL AND r.code = 'admin' AND r.status = 1 AND r.deleted_at IS NULL)
);

COMMIT;

-- 核对:两列存在且类型正确;编号无空洞(未删行为数 = 已编号行数);索引唯一;按钮节点挂在该页下且 admin 已授权
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME IN ('doc_no', 'remark');

SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_items' AND COLUMN_NAME = 'doc_no';

SELECT COUNT(*) AS total_rows, COUNT(doc_no) AS numbered_rows FROM example_items;

SELECT b.id, b.name, b.permission, b.sort, b.status, p.path AS parent_path,
  EXISTS (SELECT 1 FROM role_menus rm JOIN roles r ON r.id = rm.role_id WHERE rm.menu_id = b.id AND r.code = 'admin') AS granted_to_admin
FROM menus b JOIN menus p ON p.id = b.parent_id
WHERE b.permission = 'example-items:owner';

-- 回滚:提交前 ROLLBACK。提交后先回退配套前后端代码,再按备份与新增 ID 定向恢复;或逆向执行:
--   ALTER TABLE example_items DROP INDEX uk_example_items_doc_no;
--   ALTER TABLE example_items DROP COLUMN remark;   -- 丢失备注数据
--   ALTER TABLE example_items DROP COLUMN doc_no;   -- 丢失编号:编号对外发布后不可回收,回滚前先确认无外部引用
--   按备份恢复 menus / role_menus(或按本次新增菜单 ID 定向删除节点与授权)。
-- 不降低 token_version;回退后管理员重新登录。
