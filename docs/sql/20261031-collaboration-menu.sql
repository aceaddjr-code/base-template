-- 菜单重组：新增「工作协同」分组（紧随首页下方），系统公告、我的通知、附件管理移入该分组；
-- 系统管理保留其余页面。仅菜单数据，无表结构变更；页面路由、权限码均不变。
-- 执行顺序：完成此前适用于当前库的补丁 -> 本补丁 -> 配套发布前后端 -> 刷新页面即可拿到新菜单。
-- 执行前停止管理写入，备份 menus / role_menus，记录本次变更的菜单 ID。
-- 可重复执行：分组按 path 判重；不覆盖页面名称、启停与软删除状态；已停用分组不挂接，留给管理员核对。
START TRANSACTION;

-- 1) 补「工作协同」分组；已有同路径节点（含停用/软删除）不新建、不复活。
INSERT INTO menus (parent_id, name, path, icon, type, sort, status)
SELECT NULL, '工作协同', '/collaboration', 'TeamOutlined', 'menu', 2, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM menus m WHERE m.path = '/collaboration' AND m.type = 'menu');

-- 2) 移动三个页面到「工作协同」下并排序；页面下的按钮节点 parent_id 不变，自动跟随。
UPDATE menus page
JOIN menus grp ON grp.path = '/collaboration' AND grp.type = 'menu' AND grp.status = 1 AND grp.deleted_at IS NULL
JOIN (
  SELECT '/system/announcements' AS path, 3 AS sort
  UNION ALL SELECT '/system/notifications', 4
  UNION ALL SELECT '/system/attachments', 5
) target ON target.path = page.path
SET page.parent_id = grp.id, page.sort = target.sort
WHERE page.type = 'menu' AND page.status = 1 AND page.deleted_at IS NULL;

-- 3) 系统参数排序收紧为 97，与种子一致（移出三个页面后消除 91-98 的空档）；已是 97 则无变化。
UPDATE menus SET sort = 97
WHERE path = '/system/settings' AND type = 'menu' AND status = 1 AND deleted_at IS NULL;

-- 4) 授权分组节点：admin 例外；已拥有任一移入页面的角色一并获得，保持角色编辑界面勾选一致。
-- 菜单树构建会自动补齐祖先节点，此步不改变任何角色的实际可见范围。
INSERT INTO role_menus (role_id, menu_id)
SELECT DISTINCT r.id, grp.id
FROM roles r
JOIN menus grp ON grp.path = '/collaboration' AND grp.type = 'menu' AND grp.status = 1 AND grp.deleted_at IS NULL
WHERE r.status = 1 AND r.deleted_at IS NULL
  AND (r.code = 'admin'
    OR EXISTS (SELECT 1 FROM role_menus rm JOIN menus page ON page.id = rm.menu_id
      WHERE rm.role_id = r.id AND page.deleted_at IS NULL
        AND page.path IN ('/system/announcements', '/system/notifications', '/system/attachments')))
  AND NOT EXISTS (SELECT 1 FROM role_menus rm2 WHERE rm2.role_id = r.id AND rm2.menu_id = grp.id);

COMMIT;

-- 核对：分组与三个页面各一条启用节点，页面的 parent_path 均为 /collaboration 且 sort 为 3/4/5；
-- 系统管理下剩余 7 个页面（用户/角色/菜单/字典/日志/备份/参数，参数 sort=97）。
SELECT m.id, m.path, m.name, m.sort, m.status, m.deleted_at,
  COALESCE(p.path, '(根节点)') AS parent_path
FROM menus m
LEFT JOIN menus p ON p.id = m.parent_id
WHERE m.path IN ('/collaboration', '/system/announcements', '/system/notifications', '/system/attachments')
  AND m.type = 'menu'
ORDER BY m.path, m.id;

SELECT m.path, m.name, m.sort
FROM menus m
JOIN menus p ON p.id = m.parent_id
WHERE p.path = '/system' AND m.type = 'menu' AND m.deleted_at IS NULL
ORDER BY m.sort;

-- 回滚：提交前 ROLLBACK；提交后先回退配套前后端代码，再按执行前备份把三个页面的
-- parent_id / sort 恢复为备份值，按本次新增 ID 定向移除分组菜单及对应 role_menus。
-- 不要按路径批量删除菜单，以免误伤后续管理调整；不涉及 token_version。
