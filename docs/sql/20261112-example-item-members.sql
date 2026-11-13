-- 示例事项团队成员(2026-11-12):新建子表 example_item_members,承接单据「团队成员」多选用户字段。
-- 成员身份提供记录可见性(数据范围额外可见分支),操作仍按成员角色权限码裁决;表内不存任何权限。
-- 变更一:新建子表(item_id/user_id/软删与审计列,item_id、user_id 各建普通索引)。
--   不建 (item_id, user_id) 唯一键:编辑采用"软删旧行+插新行"的全量替换,软删后重加同一人会撞键,去重由服务层负责。
--   单据软删不联动本表(恢复单据成员原样保留);彻底删除时物理删除成员行(见 example-recycle.service purge)。
-- 开发库 DB_SYNCHRONIZE=true 会按实体自动建表,与本补丁互不冲突;本补丁面向生产(禁止依赖 synchronize)。
-- 执行顺序:停止单据写入 -> 本补丁 -> 同步发布后端 -> 前端。
-- 执行前备份:确认 example_item_members 不存在(存量业务无历史数据,无回填)。
-- 前置确认:重复执行时表已存在会跳过并提示,属预期。
-- 注意:本补丁只有 CREATE TABLE(DDL),MySQL 中 DDL 隐式提交,事务/ROLLBACK 对其无效;
--   回滚只能按文件末尾的 DROP TABLE 逆向执行。

-- 1) 结构:成员子表(幂等;DDL 隐式提交,不包事务)
SET @table_exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_item_members'
);
SET @ddl = IF(@table_exists = 0,
  'CREATE TABLE `example_item_members` (
    `id` int NOT NULL AUTO_INCREMENT,
    `item_id` int NOT NULL COMMENT ''所属示例事项ID'',
    `user_id` int NOT NULL COMMENT ''团队成员用户ID'',
    `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    `deleted_at` datetime(6) NULL,
    `created_by` int NULL COMMENT ''创建人ID'',
    `updated_by` int NULL COMMENT ''最后修改人ID'',
    PRIMARY KEY (`id`),
    INDEX `ix_example_member_item` (`item_id`),
    INDEX `ix_example_member_user` (`user_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT=''示例事项团队成员''',
  'SELECT ''example_item_members 表已存在,跳过''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 核对:表存在且两列非空、索引齐全
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_item_members' AND COLUMN_NAME IN ('item_id', 'user_id');

SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'example_item_members'
GROUP BY INDEX_NAME, NON_UNIQUE;

-- 回滚:先回退配套前后端代码,再执行(DDL 隐式提交,无法用事务回滚,只能逆向 DROP):
--   DROP TABLE example_item_members;  -- 丢失成员数据:回滚前确认无业务依赖(成员可见性随代码回退自动失效)
