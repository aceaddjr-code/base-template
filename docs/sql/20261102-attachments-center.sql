-- 附件中心改造：附件管理拆分「文件库 / 业务附件」双页签（2026-11-02）。
-- 变更一（结构）：attachments 新增 origin（上传来源）与 entity_title（绑定时单据标题快照）两列。
-- 变更二（数据）：存量 bound 行回填 origin='business'；全部行回填 owner_id=created_by（附件管理数据范围口径）。
-- 变更三（文案）：附件管理「清理过期临时附件」按钮改名为「回收已删除附件文件」（临时附件超期清理机制已取消）。
-- 执行顺序：停服或停止附件写入 -> 本补丁 -> 同步发布后端（实体已含新列）-> 前端 -> 管理员核对菜单名。
-- 执行前备份 attachments / menus 两表。
-- 前置确认：attachments 表尚无 origin、entity_title 列（重复执行 ALTER 会报 Duplicate column，属预期拦截）。

START TRANSACTION;

ALTER TABLE attachments
  ADD COLUMN origin varchar(10) NOT NULL DEFAULT 'center'
    COMMENT '上传来源：center=附件管理直传（文件库） business=业务表单' AFTER status,
  ADD COLUMN entity_title varchar(255) NULL
    COMMENT '绑定时单据标题快照，用于附件中心展示与穿透；单据改名不回刷' AFTER entity_id;

-- 存量绑定行全部来自业务表单上传流；未绑定行按文件库文件保留（不再有超期清理）。
UPDATE attachments SET origin = 'business' WHERE status = 'bound' AND origin <> 'business';

-- 历史行未维护 owner_id，统一按上传人回填，供附件管理数据范围（scopeKey=attachments）过滤。
UPDATE attachments SET owner_id = created_by WHERE owner_id IS NULL;

-- 按钮权限码不变，仅更新菜单显示名；改名不影响授权关系。
UPDATE menus SET name = '回收已删除附件文件'
WHERE type = 'button' AND permission = 'attachments:cleanup' AND name = '清理过期临时附件';

COMMIT;

-- 核对：origin 分布（bound 行应全部为 business；temp 行为 center 或 business）、owner_id 无空值、菜单名已更新。
SELECT origin, status, COUNT(*) AS count FROM attachments GROUP BY origin, status;
SELECT COUNT(*) AS missing_owner FROM attachments WHERE owner_id IS NULL;
SELECT id, name, permission FROM menus WHERE permission = 'attachments:cleanup';

-- 回滚：提交前 ROLLBACK；提交后按备份恢复 attachments / menus 两表，或逆向执行：
--   UPDATE menus SET name='清理过期临时附件' WHERE permission='attachments:cleanup';
--   ALTER TABLE attachments DROP COLUMN origin, DROP COLUMN entity_title;  -- 会丢失来源与单据标题快照
-- 回滚需同时回退配套前后端代码，否则列表查询引用 origin 列将直接报错。
