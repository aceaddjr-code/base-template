-- 第0批补齐通知页实际使用的基础字典。无结构变更，不修改已有账号/权限/业务数据。
-- 执行前备份 sys_dict_types / sys_dict_items 并记录本次前后差异；在停用管理写入的维护窗口执行。
-- 仅补缺失编码/选项；已有项（包括手工停用、软删除）不覆盖、不复活。
START TRANSACTION;

INSERT INTO sys_dict_types (code, name, status)
SELECT 'notification_type', '通知类型', 1
WHERE NOT EXISTS (SELECT 1 FROM sys_dict_types WHERE code = 'notification_type');

INSERT INTO sys_dict_items (type_id, label, value, sort, status)
SELECT t.id, '系统通知', 'system', 0, 1
FROM sys_dict_types t
WHERE t.code = 'notification_type' AND t.deleted_at IS NULL AND t.status = 1
  AND NOT EXISTS (SELECT 1 FROM sys_dict_items i WHERE i.type_id = t.id AND i.value = 'system');

COMMIT;

-- 核对：若类型被手工停用/软删除，结果保持原状态，由管理员按既有业务规则处理。
SELECT t.id, t.code, t.status, t.deleted_at, i.id AS item_id, i.label, i.value, i.status AS item_status
FROM sys_dict_types t LEFT JOIN sys_dict_items i ON i.type_id = t.id AND i.value = 'system'
WHERE t.code = 'notification_type';

-- 回滚：提交前用 ROLLBACK；提交后按执行前备份和本次新增 ID 定向恢复上述两表。
-- 不按 code 全量删除，不覆盖实施后其他管理员修改；若新增项已被使用，先评估业务引用。
