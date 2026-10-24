# 重构与评审修复实施记录

日期：2026-10-24。本记录补记初始导入（2b5a0a7）后、无独立方案文档的一批自主重构，以及同日全量代码评审（规范轴 + 需求轴）后的修复。附件挂接子表声明式改造以 [ADR-0001](adr/0001-附件挂接采用子表声明式.md) 为准，此处不重复。未部署生产，未执行数据库补丁。

## 1. 重构批次（补记）

此前 auth 与 user 各自查询映射数据范围、各自硬编码 `__global__` 兜底；直属上级与部门子树口径散落多处。本批收敛为：

| 改动 | 实际行为与入口 | 边界 |
|---|---|---|
| 数据范围读写收敛 | `UserDataScopeService` 成为配置唯一拥有者：登录会话装载、面板回显、全量替换保存共用；附 `user-data-scope.service.spec.ts` | 读侧口径不变；保存仍为物理删除 + 插入（事务）并递增 tokenVersion |
| 部门子树统一 | `common/utils/dept-subtree.ts` 统一「含下级部门」展开口径，数据范围与部门模块共用 | 仅子树 SQL 口径，不含业务状态规则 |
| 用户页拆分 | users 页拆出 `OrgTreePanel` / `UserCreateModal` / `UserDetailDrawer` / `ScopeMatrixModal` 四组件，迁 `Page` 骨架与列表四件套 | 编辑由弹窗改为 `UserDetailDrawer` 原地切换，与共享 DetailDrawer 行为对齐 |
| 角色权限矩阵提取 | `views/system/roles/permission-matrix.ts` 提取并附测试 | 仅提取既有逻辑，未改权限语义 |
| 表单弹窗统一 | `useFormModal` 状态机（未保存确认、字段反馈、加载锁四件套）；9 个系统页迁移；删除 `useCrudModal.ts` | 迁移页面行为等价（F20/F34 字段反馈、F27 视图等保留） |
| DetailDrawer API 收敛 | 移除 tabs / activeKey / beforeGroupSlots；初始导入时即无使用方 | 无破坏性调用方 |
| 拼写统一 | `EXAMPLE_ITEMS_SCOPE_KEY` 消除示例模块 scopeKey 拼写漂移 | 仅常量来源统一 |
| 前端错误上报限流 | `frontend-error.controller.ts` 增加 `@Throttle(30/分)`，README 补「安全基线」说明 | 限流命中返回 429，不做封禁 |

## 2. 评审修复（2026-10-24）

| 发现 | 修复 |
|---|---|
| `ScopeMatrixModal` 保存期间可经 mask/Esc/右上关闭 | 补齐 `mask-closable` / `keyboard` / `closable` / `cancel-button-props` 锁闭与保存重入守卫，与 `useFormModal.modalProps` 同口径 |
| users 列表 isAdmin 列内联硬编码 `#187536` | 新增主题令牌 `--color-success-text`（同 `--color-danger-text` 深一档口径），`style.css` `.ant-tag-success`、示例页 `.status-tag.is-done`、users isAdmin 三处收敛引用 |
| 直属上级选项加载与「姓名（部门）」标签拼装三处重复 | 提取 `views/system/users/leader-options.ts`（`useLeaderOptions` + `formatLeaderOptionLabel`），新增弹窗与详情抽屉共用 |
| `UserDetailDrawer` 取消编辑未重读详情 | 按共享 DetailDrawer 口径：guard 未保存确认 → 重置编辑态 → 从列表行快照重读（用户无单条详情端点） |
| `scopeType` 字符串族前后端各自裸写 | 后端 `common/utils/data-scope.ts` 定义 `SCOPE_TYPES` / `ScopeType` 单一来源（读侧分发与写侧校验共用）；前端 `api/user.ts` 定义 `ScopeType`，`UserDataScopeRow` 与矩阵行引用。`saveRows` HTTP 入参与实体列保持 `string`（不可信边界，运行时校验不变） |

## 3. 验证结果

| 验证 | 结果 |
|---|---|
| `pnpm -C backend test --runInBand` | 29 套、233 项通过 |
| `pnpm -C backend build` | 通过 |
| `pnpm -C frontend test` | 32 套、187 项通过 |
| `pnpm -C frontend build` | 通过（含 vue-tsc 类型检查） |

无数据库结构变更，无 `docs/sql` 补丁。
