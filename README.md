# 企业管理系统基础模板

用于开发以列表、表单和详情为主的内部管理系统。

后续完善统一见 [基础模板优化总方案](docs/base-template-optimization-plan-20261020.md)：汇总已有能力、待完善/新增项、GitHub 参考、分批顺序及验收要求。方案中的待办不代表功能已经开发完成。

已落地范围、验证证据和部署边界见 [优化实施记录](docs/optimization-implementation-20261021.md)：目前包括未读分页、字典缓存、删除事务、异步备份、请求追踪、启动校验、自助改密、菜单搜索，以及示例事项/操作日志的筛选和查询状态。

示例新增、详情编辑和用户新增现已支持未保存提醒、字段旁错误、可定位摘要及首错焦点。表单错误使用后端明确的字段路径；其他管理表单继续按方案迁移。

## 默认能力

- Vue 3、TypeScript、Ant Design Vue：布局、主题、列表、列设置、分页、表单和详情抽屉。
- NestJS、TypeORM、MySQL：CRUD、Excel 导入导出、上传、审计和统一错误处理。
- 本地账号与 httpOnly Cookie 登录；用户、多角色、菜单、部门、操作权限和用户级数据范围。
- 数据字典、站内通知、操作日志、数据库备份入口。
- 安全基线：写操作 CSRF 防护（Content-Type 白名单 + multipart 同源校验）；全局限流 300 次/分钟/客户端，登录 20 次/分钟、改密 5 次/分钟、前端错误上报 30 次/分钟。
- 一个 `example-items` 标准示例：批量导出/删除、长文本换行、按筛选与可见列导出，以及详情原地编辑；演示后端验证、权限和数据范围接入。

## 本地启动

环境：Node.js 22.12+、根目录 package.json 指定的 pnpm、MySQL 8+。后端和前端各自维护依赖与锁文件。

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
pnpm install:all
```

创建独立数据库：

```sql
CREATE DATABASE app_starter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

编辑 `backend/.env` 中的数据库连接、`JWT_SECRET` 和 `ADMIN_DEFAULT_PASSWORD`。管理员初始密码至少 3 位。开发环境 `NODE_ENV=development` 自动建表；空库首次启动在事务内创建默认部门、admin/user 角色、管理员和菜单。

```powershell
pnpm dev:backend
pnpm dev:frontend
```

- 前端：[http://localhost:5174](http://localhost:5174)
- 前端端口固定为 5174；如果端口被占用，启动会报错，不会自动切换到其他端口。
- 后端：[http://localhost:3010/api/v1](http://localhost:3010/api/v1)
- 管理员账号取 `ADMIN_USERNAME`，默认为 `admin`；密码取 `ADMIN_DEFAULT_PASSWORD`。

已有账号或系统配置的数据库不会在重启时重置菜单、角色或授权。新增菜单在管理界面维护；后续结构和数据变化使用 SQL 迁移。

## 权限与数据范围

系统管理默认仅系统管理员角色 `admin` 可用；角色名的其他前缀或后缀不表达管理资格。部门通过用户的 `deptId` 关联，独立于角色名称。

业务操作用 `@RequirePermission()` 或 `@CrudPermPrefix()` 校验。标准 CRUD 的列表、详情和候选值对应 `:view`，写入、删除、导入、导出分别校验自己的权限码。前端 `v-access` 只控制入口。

业务数据范围在用户管理中配置：表单设置优先于 `__global__`；未配置时仅本人。支持全部、按用户、按部门及子部门；查看他人详情、编辑他人、删除他人分别有开关。范围不会代替操作权限。权限或数据范围变化后，相关用户需要重新登录。

## 数据库升级与持续集成

- 结构/数据变化使用 `docs/sql` 增量补丁；`node scripts/migrate.mjs status|up|mark-applied` 维护 `schema_migrations` 账本（执行顺序=文件名顺序，`up` 执行前自动备份，回滚说明见 [docs/sql/README.md](docs/sql/README.md)）。
- CI（`.github/workflows/ci.yml`）在 push/PR 时并行跑：后端单测+构建、前端测试+构建、隔离 MySQL e2e（`TEST_MYSQL_DATABASE=base_template_test_<run_id>`，服务容器 MySQL 8.4 + mysqldump）与迁移执行器冒烟。浏览器流程验收不在 CI 内，按实施记录口径执行。
- 本地等价验证：`pnpm test && pnpm build`；隔离库 e2e 需显式 `TEST_MYSQL_DATABASE=base_template_test_<数字>` 与 `MYSQLDUMP_BIN`，绝不指向业务库。

## 备份与恢复

- 数据库备份：管理页「数据备份」或 `POST /system/backups/backup` 异步执行（BackupService → scripts/backup.mjs → mysqldump，gzip 存 `BACKUP_DIR`，默认项目根 backups/）。执行器默认 `process.execPath` 运行脚本，Windows/Linux 一致；依赖 mysqldump 可用（`MYSQLDUMP_BIN` 或 PATH）。
- 附件文件：存储于 `ATTACHMENT_PRIVATE_DIR`（默认 uploads-private，按年/月分层），需按目录纳入文件级备份——与应用内数据库备份是两条独立链路。
- **恢复演练**：`node scripts/recovery-drill.mjs` 对一次性命名库做全链路演练（应用路径备份 → 删库删文件 → 恢复 → 行数/哈希/登录/下载逐项核验并计时），仅接受 `base_template_b*/drill/test_<数字>` 库名。最近一次演练记录见 [docs/recovery/recovery-drill-20261023.md](docs/recovery/recovery-drill-20261023.md)。

## 开发新业务

1. 修改 `frontend/.env` 的系统名称、副标题和 `frontend/public/logo.ico`，使用独立数据库。
2. 参考 `backend/src/modules/example` 和 `frontend/src/views/examples/items`，替换实体表名、字段、路由、权限码、页面存储 key、Excel 列和测试名称。
3. 编写创建/更新 DTO，后端验证由 HTTP 与导入共用；菜单中建立按钮权限并给角色授权。
4. 使用数据范围时，在 `backend/src/modules/user/scope-form.registry.ts` 注册 scopeKey。
5. 完成真实业务后可删除示例：同步删除 ExampleModule 的导入、前端路由/API/页面、范围注册和空库种子中的示例菜单。已有数据库通过备份后的增量 SQL 清理示例菜单、授权和表。

页面约定见 [页面布局规范](docs/页面布局规范.md)，开发边界见 [AGENTS.md](AGENTS.md)。组件以真实源码为准，文档不复制组件实现。

## 验证与部署

```powershell
pnpm build
pnpm test
pnpm -C backend test:e2e --runInBand
```

常规单元测试和 HTTP 控制器测试使用测试替身，不连接实际数据库；真实账号、数据库和浏览器流程需要在隔离环境验收。四项标准能力的复制与验收说明见 [模板能力完善记录](docs/template-capabilities-20261018.md)。

生产环境使用 `NODE_ENV=production`，通过经审查的结构 SQL 初始化和升级；部署前备份，不依赖 TypeORM 自动同步。旧版数据库升级见 [SQL 说明](docs/sql/README.md)，全新数据库无需执行历史升级补丁。

HTTPS 部署设置 `COOKIE_SECURE=true`。`TRUST_PROXY_HOPS` 按实际可信代理层数配置，直连默认为 0。图片上传上限 10MB，普通文件 20MB；代理层限制需与之匹配。JSON 请求默认上限 1MB，可通过 `BODY_LIMIT` 调整。

备份默认使用跨平台 `scripts/backup.mjs`，依赖可用的 mysqldump；通过 `MYSQLDUMP_BIN` 指定可执行文件，`BACKUP_DIR` 指定目录。默认保留 30 天，可设置 `KEEP_DAYS`；`BACKUP_TIMEOUT_MS` 限制执行时间。需要沿用旧脚本时同时配置 `BACKUP_SCRIPT` 与 `BACKUP_EXECUTABLE`（例如 bash）。当前入口支持手动备份及本进程执行状态，没有内置每日定时任务、远程副本或一键恢复；恢复演练仍须在隔离环境完成。

`.env`、运行数据、`.scratch` 和个人 Agent 会话目录不进入版本控制；交付模板使用 Git 中的源码与文档。
