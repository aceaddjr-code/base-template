# 架构审查实施记录

日期：2026-10-18（Asia/Shanghai）

审查报告中的三项深化均已实施：登录会话、数据范围操作、表格列偏好。此前用户管理窄屏布局和共享横滚条修复保留。本轮没有数据库结构、权限配置或依赖变更。

## 实施结果

| 项目 | 当前行为 | 主要入口 |
|---|---|---|
| 登录会话 | 用户、菜单、操作权限码完整加载后统一发布；并发初始化去重；旧请求不能覆盖新会话；资料映射、退出清理集中处理 | `frontend/src/stores/app.ts` |
| 数据范围操作 | 详情、编辑、删除在既有 CRUD 内部统一完成“范围内读取→操作校验”，调用方无需组合两个步骤 | `backend/src/common/services/crud-base.service.ts` |
| 表格列偏好 | 两个展示入口共享一套恢复、显隐、排序、锁定列与默认值逻辑；列全集独立于可见结果 | `frontend/src/composables/useColumnConfig.ts` |

登录页、路由守卫、个人资料抽屉和退出入口改为调用会话行为。仍使用现有 Cookie 登录与 401 整页跳转。资料接口未返回角色列表或部门名称时保留同一账号已有信息；返回明确空值时按接口结果更新。退出接口失败时保留当前会话并反馈错误。

数据范围保留现有含义：列表可见与查看他人详情分别判断；编辑仍需同时满足查看和编辑要求；删除保留独立开关。范围外目标仍返回 404，操作权限码仍由后端守卫兜底。admin、本人、无归属人及未开启数据范围的分支维持原规则。

列偏好保留已有存储 key 和数组格式，兼容历史列宽配置且不覆盖已有独立列宽。恢复时移除无效或重复项，合并新增列，锁定列始终可见。返回原列对象以保留渲染函数与列宽引用。用户和菜单页显式保留列全集，隐藏列刷新后仍可重新显示。

浏览器复验中发现模板内联 `['actions']` 每次渲染生成新数组，可触发偏好回写循环。现按锁定 key 集合的实际变化更新，并新增真实父组件重绘回归用例；示例页已实际复验通过。

根 `package.json` 同时修正测试命令多传一个 `--` 的问题，`pnpm test` 现在可直接运行前后端测试。新增 `GLOSSARY.md` 记录本项目授权和列展示用语。

## 验证结果

| 命令或检查 | 结果 | 证据边界 |
|---|---|---|
| `pnpm test` | 后端 12 个测试集、105 项；前端 8 个测试文件、61 项全部通过 | 包含本轮 CRUD、会话、列偏好及此前横滚条测试 |
| `pnpm build` | 后端 Nest 构建、前端类型检查与 Vite 构建通过 | 构建成功不代表生产验收 |
| `pnpm -C backend test:e2e --runInBand` | 2 个测试集、6 项通过 | HTTP 控制器测试使用身份或存储替身 |
| 隔离 MySQL 8.4.0 + 完整 Nest HTTP | 85 项断言通过、0 项失败 | 独立临时库及端口 3012；另外确认进程停止、临时库删除、端口释放 |
| 实际浏览器 | 登录、退出、错误密码、受保护路由、资料加载及三个页面列偏好通过 | 没有提交个人资料修改；保存失败与迟到请求由单元测试覆盖 |

真实 MySQL/HTTP 检查覆盖本人、全部、指定用户、部门及子部门、表单范围优先、空目标回退本人、范围外 404、操作权限码 403、他人查看/编辑/删除开关、无归属人、JWT 失效、拒绝后数据不变、实际软删除，以及列表/候选值/Excel 导出的范围一致性。测试数据只写入独立临时库，已清理。

本次集成检查脚本及原始结果保存在本机 `.scratch/architecture-http-check.cjs`、`.scratch/architecture-http-results.json`。脚本从现有开发环境读取数据库配置，在新临时库执行；不要指向生产数据库。临时检查未纳入常规测试命令。

## 浏览器核验

为避免退出测试影响用户正在查看的 `127.0.0.1` 登录，使用独立 `localhost` 标签页验证同一开发服务。

| 场景 | 结果 |
|---|---|
| 未登录访问示例事项，登录后返回原目标 | 通过 |
| 退出后再次访问受保护页面 | 返回登录页，通过 |
| 错误密码 | 显示账号或密码错误，修正后登录成功 |
| 个人中心 | 用户、角色、部门加载正常；未提交修改 |
| 示例事项、用户管理、菜单管理 | 隐藏列→刷新仍隐藏→面板仍可选择→重新显示，全部通过 |
| 示例事项拖拽排序、恢复默认、操作列锁定 | 通过；页脚共 1 条与实际记录一致 |

截图目录：`C:/Users/Admin/.codex/visualizations/2026/10/18/01a14d56-211d-71d3-9493-0e17632bb62e`。

- `architecture-implemented.jpg`：最终示例事项页。
- `architecture-columns-items.jpg`、`architecture-columns-users.jpg`：列偏好恢复结果。
- `architecture-session-profile.jpg`：真实资料加载。
- `architecture-login-failure.jpg`：错误密码反馈。

前一轮视觉核验记录仍保留首次问题和修复读数；本记录补充架构实施后的结果。未扩大为所有角色、全部业务、其他浏览器或真实手机设备的完整验收。

## 文件范围与恢复

当前目录没有 `.git`；无法执行有效的 `git status` 或生成提交差异。已使用修改前副本和 `git diff --no-index` 检查本轮生产文件，空白检查通过。没有执行提交或推送。

主要修改文件：

- 会话：`frontend/src/stores/app.ts`、其测试、`router/index.ts`、`views/login/index.vue`、`components/ProfileDrawer.vue`、`layouts/BasicLayout.vue`。
- 列偏好：`frontend/src/composables/useColumnConfig.ts`、其测试、`components/ColumnPreferences.test.ts`、`ColumnPanel.vue`、`ColumnSettings.vue`、`PageToolbar.vue`、用户页和菜单页。
- 数据范围：`backend/src/common/services/crud-base.service.ts`、新增 `crud-base.scope.spec.ts`。
- 文档及命令：`GLOSSARY.md`、本记录、根 `package.json`。

恢复时只还原本轮文件，保留此前视觉修复和环境配置：

1. 会话文件及根脚本的修改前副本在 `.scratch/architecture-before-20261018-141114`。
2. 列偏好生产文件副本在 `.scratch/architecture-columns-before`；测试文件副本不作为原始字节级恢复依据。
3. CRUD 的变更前文本在 `.scratch/architecture-scope-before/crud-base.service.ts`，由本轮补丁反向重建，属于文本恢复依据。
4. 新增测试、词汇表与本记录需单独处理；恢复代码后重新执行 `pnpm test`、`pnpm build` 和相关浏览器检查。无需执行数据库回滚。

开发预览保持运行：[示例事项](http://127.0.0.1:5174/examples/items)。后端使用 3011，当前健康检查确认数据库已连接。
