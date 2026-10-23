# 基础模板开发约定

本仓库是企业管理系统基础模板。沟通和产品文案默认使用中文。

## 分层与复用边界

- `backend/src/common` 只放跨业务稳定复用的能力，不出现具体业务名词和状态规则。
- `backend/src/modules` 每个目录拥有自己的业务规则、实体、控制器和验证。
- `frontend/src/components`、`composables` 只放跨页面共享的交互；业务页面放在 `views`。
- 共用规则在后端执行，前端只负责预校验和反馈，不能成为权限和状态流转的唯一裁决者。
- 只有出现两个真实调用方后才提取新 seam；不要为了未来可能复用提前建立空抽象。

## 权限与数据范围

- 操作权限决定能做什么，数据范围决定能操作哪些记录，业务状态决定当前是否允许操作。
- 前端使用 `v-access` 控制入口，后端使用 `@RequirePermission()` 或 `@CrudPermPrefix()` 兜底。
- 使用数据范围的业务模块必须在 `scope-form.registry.ts` 注册，并在后端列表、详情、修改、删除和导出入口保持一致。
- 不按角色中文名、职位或人员姓名写死业务资格；系统管理员 `admin` 是初始化和系统管理例外。
- 权限配置修改后重新登录，使新 JWT 生效。

## UI

- 页面布局遵循 `docs/页面布局规范.md`；主题以 `frontend/src/style.css` 和 `frontend/src/App.vue` 为准。
- 新列表页使用 `Page`、`PageToolbar`、`ListFooter` 和 `useResizableColumns`。
- 新增使用纵向表单弹窗；普通查看与编辑共用 `DetailDrawer`，字段原地切换，保存和取消后留在查看态。审批、指派等流程动作保留专用交互。
- 公共交互缺陷在共享层修复，并检查所有使用方。

## 验收

- 后端逻辑：运行相关 Jest 测试；模块接线变化运行 `pnpm -C backend build`。
- 公共后端、认证、权限和数据范围：额外运行 `pnpm -C backend test --runInBand`。
- 前端：运行 `pnpm -C frontend build`；交互变化检查加载、空态、失败态和响应式布局。
- 数据库结构：新增 `docs/sql` 增量补丁，说明执行顺序和回滚方式；禁止在生产环境依赖 synchronize。
- 交付前检查 `git status --short` 和 diff，不覆盖用户已有改动，不使用 `git add .`。

## 新业务清单

复制示例模块后，必须修改实体表名、路由、权限码、scopeKey、菜单、页面存储 key、Excel 列和测试名称。删除与新业务无关的示例字段，禁止用假数据或静默吞错掩盖未完成的接口。
