-- 执行于 20261103-recycle-bin.sql 之后；将回收站移至系统公告上方。
-- 回滚：将回收站 sort 改回本环境执行前记录的数值（旧补丁默认 6）。
UPDATE menus AS recycle
JOIN menus AS announcement ON announcement.parent_id = recycle.parent_id
  AND announcement.path = '/system/announcements' AND announcement.deleted_at IS NULL
SET recycle.sort = announcement.sort - 1
WHERE recycle.path = '/system/recycle-bin' AND recycle.deleted_at IS NULL;
