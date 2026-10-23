# 基础公共能力优化调研

> 已整合进[基础模板优化总方案](base-template-optimization-plan-20261020.md)。本文保留源码盘点与来源证据；当前范围、优先级和实施批次以总方案为准。

核验日期：2026-10-20。本文包含当前源码盘点、GitHub 一手来源和实施优先级。当前仅调研，没有按这些来源修改业务源码、安装新依赖或向 GitHub 写入内容。当前目录没有 `.git`；结论基于此次实际读取的源码，不代表运行中服务或生产环境已完成验收。

## 结论与建议顺序

项目已经具备一个内部管理系统的核心骨架。下一轮建议围绕公共能力的完整性、可靠性和复用体验推进。

| 优先级 | 优化项 | 当前基础与差距 | 最小交付目标 |
|---|---|---|---|
| P1 | 附件生命周期 | 已有上传过滤、大小限制、随机存储名；目前返回静态 URL，缺少文件归属和业务关联 | 文件记录、临时上传/绑定/清理、按业务记录鉴权的下载/删除；公开头像资源与私有业务附件采用对应访问策略 |
| P1 | 耗时任务 | 已有 Excel 和备份功能；备份同步阻塞，导出整批加载，导入逐行同步处理 | 先消除同步脚本阻塞；真实耗时导出/备份接入任务状态、进度、失败原因、重试和结果下载 |
| P1 | 公共写入可靠性 | 创建、修改有事务；通用主子表删除未整体包事务，更新没有客户端版本条件 | 主子删除原子性；对多人编辑模块提供冲突提示；对需要防重复的写入口选择性引入幂等 |
| P1 | 列表查询与字典缓存 | 已有分页、列设置、筛选白名单、列表/导出共用后端查询；前端状态仍分散 | 两个真实列表共用查询状态协议；支持明确刷新/失效的字典缓存，避免修改字典后仍读旧值 |
| P1 | 排障与审计闭环 | 已有请求号、日志、前端错误上报；关联信息和业务变更摘要仍不完整 | 用户可复制错误编号；请求、错误、审计能关联；递归脱敏、失败可观察及合理保留策略 |
| P1 | 可重复部署与升级 | 已有构建、单测、HTTP 测试和手工 SQL；缺少本仓库的 CI、迁移执行状态和统一配置校验入口 | 启动前检查配置；空库初始化/旧库升级可重复验证；隔离 MySQL 集成测试进入交付流程 |
| P2 | 会话、通知与个人偏好 | 已有登录授权、通知收件箱、列偏好与最近访问 | 按需要增加单设备会话撤销；真实通知场景接入后补去重/重试；个人偏好按账号隔离、常用筛选可还原 |

P1 表示优先补齐的基础项，并非已确认线上事故或漏洞；各项仍需拆分，不能作为一次整体重构的范围。

推荐分三批交付：

1. **先收口现有能力**：字典刷新/失效、备份异步进程、主子表删除事务、错误编号贯通。变更范围较明确，能马上减少使用和排障问题。
2. **再形成可复用能力**：附件资源管理、查询状态协议；在现有备份和实际耗时导出中落地任务能力，再决定是否需要持久队列/独立 worker。
3. **按真实业务扩展**：并发编辑冲突、业务幂等、通知重试、在线设备、常用视图与回收站。多租户、复杂工作流和低代码设计器留待明确业务需要。

## 当前源码依据与验收口径

### 已有能力应保留

- Cookie 登录、bcrypt、多角色、操作权限、用户级数据范围已经存在；JWT 校验会核对 `tokenVersion`，角色授权或用户范围变更会递增版本。不能把“权限即时失效”整体写成尚未实现。依据：`backend/src/modules/auth/jwt.strategy.ts`、`backend/src/modules/auth/auth.service.ts`、`backend/src/modules/role/role.service.ts`、`backend/src/modules/user/user.service.ts`。
- 列表已有排序/筛选白名单、日期/数值范围，导出复用相同后端查询和数据范围；现有限制为选中最多 500 条、导出最多 50000 条。不能把高级筛选或按权限导出全部重新实现。依据：`backend/src/common/services/crud-base.service.ts`、`backend/src/common/utils/list-query.ts`。
- `Page`、`PageToolbar`、`ListFooter`、列偏好、列宽和 `DetailDrawer` 已经成型。示例列表还有迟到请求保护。应复用现有 Ant Design Vue 组件和交互，避免更换表格库破坏已验证行为。依据：`frontend/src/components`、`frontend/src/composables`、`frontend/src/views/examples/items/index.vue`。
- 密码最短 3 位是用户已明确确定的规则，本轮优化建议不擅自恢复为 8 位，也不修改任何现有账号密码。

### A. 上传接口升级为文件资源管理

现状依据：`backend/src/common/uploads/upload.controller.ts` 仅返回 `/uploads/...` URL；`backend/src/main.ts:13` 挂载静态文件。当前主源码未发现独立附件记录、业务附件关联和按关联记录鉴权的下载流程。`upload.service.ts` 已有后缀/MIME 白名单、随机文件名与容量限制，需在此基础上完善，不能描述成完全没有校验。

建议最小范围：`fileId`、原始名、大小、实际类型、存储位置、上传人、临时/已绑定状态；新增绑定与释放流程。私有附件不走可直接匿名访问的静态目录。存储层先实现当前本地磁盘方式，出现第二种真实存储调用方后再提取可替换接口。

验收：无记录访问权的人不能仅凭 fileId 下载；取消新增后的临时文件可清理；绑定失败不丢失追踪记录；删除/重试不误删仍被引用的文件；类型伪装可被识别。

### B. 耗时操作避免占用请求和主进程

现状依据：`backend/src/modules/system/backup.service.ts:53` 使用 `execFileSync`，超时为 120 秒；其执行期间会阻塞该 Node 进程事件循环。通用导出通过 `getMany()` 读取至多 50001 条并生成完整 Buffer；导入先解析整份文件，再逐行调用创建。前端请求超时默认 10 秒，见 `frontend/src/api/request.ts`。

建议先把备份改为异步子进程并记录运行状态/超时，避免额外基础设施。需要持续进度、断点恢复或重试时，再设计持久任务；受理后返回任务编号，页面查询进度，完成后下载。保留小数据同步路径。

验收：备份运行时健康检查/普通列表仍可响应；失败可定位，不将旧备份误报为本次结果；重复点击有明确处理；结果下载核对当前用户权限和保留时间。导入必须明确“部分成功”或“整体回滚”，重试不能重复建单。

### C. 通用数据写入的完整性

现状依据：`backend/src/common/services/crud-base.service.ts:348` 修改使用事务，但 `remove()` 中主表与子表依次软删除，没有整体事务；当前示例未配置子表，故不能据此声称已经发生过数据不一致。`BaseEntity` 有 `updatedAt`、没有版本列；通用更新按 id 执行 `manager.update()`，没有 expectedVersion 原子条件。

建议：先锁定删除中子表失败的回滚测试；多人编辑场景采用版本条件原子更新与 409 冲突提示。需要防重复的新增/外部动作采用稳定幂等键和业务唯一约束；不能仅依赖前端 loading 或为所有 CRUD 默认建立复杂分布式锁。审批和业务状态仍由具体模块裁决。

验收：删除任一子表失败时主表仍在；两个用户基于同一版本编辑，后提交者收到冲突而不是覆盖；同一幂等请求重复发送不创建两条业务记录。

### D. 查询状态和字典刷新

现状依据：`frontend/src/composables/useListPage.ts` 负责分页和横滚来源；示例页面自行维护关键词、表头筛选、排序、导出列、选中项和加载状态。其已有 `listVersion` 保护，应保留。`useDict.ts:16` 的 `refresh()` 优先返回模块 Map 缓存，未提供强制刷新、失效或在途请求合并；日志和通知页是两个真实消费方。

建议：先提供字典 `refresh({ force: true })`/按编码失效，字典管理成功后触发同步，按登录会话处理缓存。列表查询状态在示例与一个真实系统列表共同验证后共享；URL 状态和常用视图只保存允许的筛选字段，不持久化服务端授权结果。列表与导出仍使用同一份已生效查询条件。

验收：字典改名或停用后，已打开页面刷新可以看到新值；两个页面同时请求同一字典不会重复加载；翻页和返回列表可恢复预期筛选；导出条件与列表一致；账号切换不会继承不应共享的偏好。

### E. 请求号、错误上报与审计

现状依据：`RequestIdMiddleware` 已生成响应头 `X-Request-ID`，但错误响应、前端 `reportRequestError()`、`SystemLog` 实体和审计写入未形成统一关联字段。`AuditInterceptor.sanitizeDetail()` 只按顶层 key 剔除敏感字段；`SystemLogService.write()` 捕获写入错误并告警，不能误报为“所有异步失败都会造成未处理异常”。前端已有批量上报，后端当前主要输出文本日志。

建议：统一请求号、错误码、模块/记录、动作、耗时、结果；对敏感信息递归脱敏，并给上报的条数和单条大小设限制。业务审计与技术错误分别保留语义，通过请求号关联；关键变更摘要由实际业务写入口产生，避免猜测请求体就能得到准确 old/new。

验收：用户复制一个错误编号，能查到对应 API 和业务记录；嵌套密码/令牌不落日志；失败上报不会反过来递归淹没系统；重要审计失败有可见的处理渠道。

### F. 配置、迁移、健康检查和交付

现状依据：`ConfigModule.forRoot()` 没有统一 `validate`/schema；部分入口单独校验必填项；`app.module.ts` 明确只有 development 才 synchronize。`docs/sql/README.md` 有手工升级/备份/回滚说明，但当前未找到迁移执行器和版本状态入口。当前根目录及 backend 不存在 `.github` 目录；现有 HTTP 测试使用身份/仓储替身，真实 MySQL 核验脚本保存在 `.scratch`，还不是稳定交付测试入口。

建议：保持生产禁止 synchronize，给 SQL/迁移加入版本、执行状态及发布检查；配置错误在启动前集中反馈。首次安装校验、存活/就绪检查、标准化开发启动和隔离 MySQL 集成用例进入受维护脚本/CI。CI 跑 SQL 和测试不等于自动获准对生产执行迁移；备份仍需有恢复演练。

验收：新机器照文档能启动；缺必填配置清楚报错；空库和已升级库各走一遍迁移；重复部署不重置权限菜单；数据库不可用时就绪检查不能仍宣称可接流量。

### 后续能力的明确边界

- 会话：现有 tokenVersion 已能让旧授权失效。新增的是指定设备/会话粒度的退出和可查询记录，不是重写授权。
- 通知：目前有收件箱、未读数、标已读和写入服务，本次在后端主源码中没有发现业务模块调用 `notify()`。先接入一个真实业务提醒，再按失败重试/去重需求增加可靠投递；不要先建多渠道消息平台。
- 偏好：列偏好、列宽和最近访问已有；按账号隔离、常用视图与跨设备同步按需求逐步补。
- 回收站：已有软删除可以作为基础；恢复还必须处理权限、数据范围、唯一键冲突和业务关联，不能给所有实体机械增加 restore。
- 实施遵循 `AGENTS.md` 的两个真实调用方规则。不给 `common` 加入业务状态、审批资格或具体业务字段，也不为未来可能使用的功能建立空接口。

以下是对应的外部一手来源。

## 调研方法与适用边界

通过用户指定的 GitHub 插件检索官方仓库并读取实际源码，必要时补查维护方官方文档。选取与 Vue 3、TypeScript、企业管理、NestJS 最相关的五个主仓库，另用 TypeORM 官方源码补证数据库机制。不以星数证明质量，也不把项目宣传页当作已完成的功能验收。

下文“已核对”指实际读取了所链接的源码或官方文档；“本项目建议”属于适配推论，不能解释为参考项目已经实现了完整闭环。仓库默认分支可能继续变化，部分源码链接固定到本次搜索得到的提交。落地前仍需与本仓库锁文件中的具体版本核对。

## 一、Vue Vben Admin：借鉴列表和表单的协同接口

官方仓库：[vbenjs/vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)。

已核对：`useVbenVxeGrid` 将 Grid 组件与 API 一起返回，并在组件卸载时清理；`VxeGridApi` 集中管理查询、重载、搜索表单显隐、loading 和选项状态。它展示的是列表与查询表单协作的封装边界，不能证明本项目应当更换表格库。[组合入口](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/plugins/src/vxe-table/use-vxe-grid.ts)、[Grid API](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/plugins/src/vxe-table/api.ts)。

本项目建议：在现有 Ant Design Vue 列表能力上补齐一种稳定的查询状态协议，让筛选、分页、排序、勾选导出读取同一份状态；按需增加 URL 状态还原、清除筛选、保存常用筛选。将业务字段与通用查询状态分开；至少有两个真实列表复用后再抽取共享接口。

适配成本：低至中，主要是现有组合函数和调用方整合。无需搬入 Vben monorepo、VXE、整套 Schema 表单；该源码的 `query/reload` 会捕获异常并输出日志，不能直接作为本模板失败反馈设计的范本。

## 二、Cool Admin Midway：借鉴后端可撤销会话和授权缓存

官方仓库：[cool-team-official/cool-admin-midway](https://github.com/cool-team-official/cool-admin-midway)，本次默认分支为 `8.x`。

已核对：登录服务分别生成 access token 与 refresh token，将权限、部门和 token 存入缓存，并写入密码版本；权限中间件校验 token、密码版本以及缓存权限，存在可配置的单点登录 token 比对。[登录服务](https://github.com/cool-team-official/cool-admin-midway/blob/e545ef6f3b0c08581e34bd3207ca57d851ccc3ae/src/modules/base/service/sys/login.ts)、[权限中间件](https://github.com/cool-team-official/cool-admin-midway/blob/e545ef6f3b0c08581e34bd3207ca57d851ccc3ae/src/modules/base/middleware/authority.ts)。

本项目建议：在已有 tokenVersion 和授权变更失效机制上，按需求补充“按单个设备/会话撤销”以及“我的登录设备 / 退出其他设备”，避免重复建设已有能力。若引入刷新令牌，应重新检查当前账号与授权，不能只重新签发旧 JWT 的授权快照。当前会话管理是否达到上述粒度，以后续本地代码盘点为准。

适配成本：中，需要后端会话记录、撤销/刷新接口以及前端失效处理；可先用现有数据库承载，不必为这一项单独强制引入 Redis。参考仓库密码校验部分使用 MD5，本模板不应照搬；本次也没有把该仓库的刷新实现认定为安全最佳实践或完整多设备会话实现。

## 三、RuoYi Vue Pro：借鉴文件资源管理和可控审计字段

官方仓库：[YunaiV/ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro)。其后端是 Java，适合借鉴能力边界，不能直接移植实现。

已核对：文件服务把存储客户端与文件数据库记录分开，包含内容类型检测、路径/文件名校验、文件元数据、签名上传/访问与删除；访问日志注解可控制请求/响应记录，配置敏感字段剔除和操作模块/名称。[文件服务](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/service/file/FileServiceImpl.java)、[日志注解](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/apilog/core/annotation/ApiAccessLog.java)。

本项目建议：附件返回 fileId；记录原始名、实际存储名、大小、类型、上传者、业务模块/单据关联及状态。下载、预览和删除先按所关联单据做权限与数据范围检查；临时上传需有绑定/过期清理，不能只保存 URL。存储与数据库删除失败需能重试和追踪。文件允许类型按本模板业务制定，不能照搬包含 HTML/SVG 等类型的宽泛白名单；签名地址也不能替代业务授权。

审计建议记录“谁在何时对哪条记录执行什么操作、成功或失败、关联请求号”；敏感字段统一剔除。业务字段变更摘要属于本项目需要设计的能力，不能仅凭该日志注解宣称参考项目提供了全部前后值审计。

适配成本：中。可先完善本地磁盘存储及 fileId 生命周期；出现真实对象存储调用方时再建立第二种存储适配器。Java 模块、租户平台和整套基础设施中心都不需要搬入。

## 四、NestJS Bull / BullMQ：借鉴持久后台任务和可观察重试

官方仓库：[nestjs/bull](https://github.com/nestjs/bull)。仓库包含 Nest 的 Bull 与 BullMQ 集成。[仓库说明](https://github.com/nestjs/bull/blob/master/README.md)。

已核对：Nest 官方文档提供生产者/消费者、进度事件、`attempts`、`backoff`、`jobId` 与失败任务保留选项；BullMQ 依赖 Redis。它适合将耗时导出和通知投递从同步请求中移走。[Nest 队列文档](https://docs.nestjs.com/techniques/queues)。

本项目建议：出现真实耗时或重试需求后，共享任务中心提供排队、执行、成功、失败、进度、错误摘要、发起人及结果下载。现有备份与大导出可以作为候选调用方；通知投递等有真实业务调用后再接入。少量导出继续同步完成；导入增加预校验、错误行报告和明确的部分成功/全量回滚策略，不能把“上传成功”当“导入成功”。

任务受理、执行和下载结果均需考虑授权变化；建议执行/下载时重新校验当前操作权限与数据范围。任务只记录必要参数，不能把整份 JWT 或密码放入队列。任务结果有保留时间，过期后同时清理文件。

重试必须幂等。BullMQ 官方说明要求首次成功与失败后重试成功产生相同最终状态，复杂多动作任务应拆分；唯一 jobId 仅减少重复入队，不能替代业务唯一约束、事务或外部接口幂等键。[BullMQ 幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)。

适配成本：中至高，新增 Redis 与 worker 的部署、监控、恢复及任务数据清理。若仍是单实例、小数据量，没有必要先搭建完整队列平台。

## 五、NestJS Terminus：借鉴依赖就绪检查

官方仓库：[nestjs/terminus](https://github.com/nestjs/terminus)。

已核对：官方示例通过 `HealthCheckService.check()` 聚合自定义健康指标，由专门 controller 暴露检查入口。[健康检查源码示例](https://github.com/nestjs/terminus/blob/master/sample/000-dogs-app/src/health/health.controller.ts)、[官方文档](https://docs.nestjs.com/recipes/terminus)。

本项目建议：区分进程存活与依赖就绪。前者尽量轻量；后者检查数据库及实际启用的存储/队列，以便部署启动和故障排查。检查输出不要暴露连接密码或内部堆栈。先记录请求号、响应耗时、错误率、后台任务失败情况，再根据实际部署接入指标平台。

适配成本：低至中，取决于是否已有健康检查及部署探针；无需因此引入完整云平台、收费可观测性产品或分布式链路系统。

## 六、补充一手依据：迁移、配置、并发与交付

- 数据库迁移：TypeORM 官方 CLI 支持按顺序运行待执行迁移，并要求运行时与 TS/JS 产物对应。建议将已有增量 SQL 纳入可查询版本、可验证执行状态的发布流程；生产禁止靠 synchronize 升级。回滚方案需考虑 MySQL DDL 的实际行为，不能把存在 down() 当作可安全回滚的保证。[TypeORM 官方执行文档源码](https://github.com/typeorm/typeorm/blob/fe92394287516feeada6e9c308ebe22deca2458e/docs/docs/migrations/05-executing.md)。
- 配置：Nest 官方支持启动时校验环境变量，校验失败则拒绝启动。建议明确端口、数据库、上传目录、代理目标、JWT secret 和生产必要项；开发默认值与生产必填分离。具体校验库应匹配本仓库依赖版本，而非照抄最新版示例。[Nest 配置与校验](https://docs.nestjs.com/techniques/configuration)。
- 并发编辑：TypeORM `VersionColumn` 可记录递增版本。建议本项目写入时使用受数据范围约束的 `WHERE id = :id AND version = :expected` 条件原子更新；未命中返回明确冲突，再让用户重新载入。仅添加版本列不能保证所有更新路径自动阻止覆盖，这是适配设计而非源码已证实的保证。[TypeORM 版本列源码](https://github.com/typeorm/typeorm/blob/fe92394287516feeada6e9c308ebe22deca2458e/packages/typeorm/src/decorator/columns/VersionColumn.ts)。
- CI：建议检查类型、相关单元测试、完整构建，并在隔离 MySQL 上覆盖迁移和权限/范围关键集成用例；这是针对本项目的交付建议，本次没有对参考仓库的 CI 可用性或测试覆盖率作出认证。

## 不能仅凭本轮资料下结论的事项

- 未在这些参考项目本地部署或跑其测试，没有给出性能、漏洞数量、覆盖率或维护承诺。
- 未确认其所有功能是否存在于本项目安装的 NestJS / TypeORM 具体版本；落地前需要查锁文件并做最小验证。
- 附件业务归属、授权更新策略、导入事务语义、任务结果的数据快照规则和通知渠道，需要结合本项目实际模块确定。
- 在线会话、任务中心、审计和监控可以共享基础信息，但它们的数据保留规则和权限不能直接等同。
