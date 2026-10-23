# 基础能力补充：GitHub 一手来源核查

核查日期：2026-10-20。本文是总方案的补充来源说明，只记录已读取的源码、适用建议和边界；未修改应用功能。现有三份调研报告继续保留。

> 当前范围、优先级和实施批次统一见[基础模板优化总方案](base-template-optimization-plan-20261020.md)。下文只保留来源事实及适配建议。

## 1. 接口文档与 OpenAPI 合同

**来源已证明的行为**：Nest 官方文档通过 `@nestjs/swagger`、`DocumentBuilder`、`SwaggerModule.createDocument()` 生成 OpenAPI 文档，支持 Swagger UI、JSON 文档及保存 JSON/YAML 文件。文档列出 `extraModels`、模块范围等配置。

来源：[Nest 官方 OpenAPI 文档源码，固定提交](https://github.com/nestjs/docs.nestjs.com/blob/ccbc1fad0dceb2abde3bfd47c12af63bf4da713b/content/openapi/introduction.md)。

**本模板现状**：本轮读取 `backend/src/main.ts`、`backend/src/app.setup.ts` 和 `backend/package.json`，未见 Swagger 依赖和启动接线。全局响应包装、验证、异常过滤与 `api/v1` 前缀已经存在，文档应准确描述这些实际协议。

**建议范围**：先补认证、公共 CRUD、筛选/排序、分页、导入导出和错误响应的真实合同；以示例模块验证生成文档。开发与受控测试环境提供在线文档，交付可保存 OpenAPI 文件。后续可用合同生成前端类型或对比接口变更，但这属于本项目扩展，不代表安装 Swagger 会自动生成正确业务约束。

**验收边界**：通用基类和泛型分页 DTO 需显式声明，核对日期、数字区间、多选及上传下载的格式；Cookie 认证和权限码要准确记录。文档并不替代权限执行或真实 API 测试，不能把生产在线文档无条件公开作为默认配置。

## 2. 导入完整闭环：模板、预校验与结果明细（合并既有导入优化项）

**来源已证明的行为**：RuoYi 的用户接口提供 Excel 模板下载，导入参数支持是否更新已有用户；服务逐项校验字段和业务条件，记录创建成功、更新成功和失败原因。代码在同一轮遍历中校验并写入，不是独立的“上传后仅预览、确认后写入”。

来源：[UserController：模板下载和导入入口](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/UserController.java#L173)、[AdminUserServiceImpl：校验和逐项结果](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/service/user/AdminUserServiceImpl.java#L548)、[UserImportRespVO：结果结构](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/vo/user/UserImportRespVO.java)。

**本模板现状**：`backend/src/common/services/crud-base.service.ts:511` 已按行调用 `create()` 并返回完整 `errors`，错误包含 Excel 行号；`frontend/src/views/examples/items/index.vue:172` 只在提示中展示前 3 条；`PageToolbar.vue` 已有上传确认弹窗。因此应升级已有流程，而非重复建设“行号错误收集”。

**建议范围**：模块按已有列映射提供空模板和字段说明；上传后展示识别列、总行数、可导入/失败数量和完整错误表格，支持下载错误明细；明确“只新增／按明确业务键更新”和“部分成功／整体回滚”的模块策略。独立预校验、错误文件下载是本模板拟新增能力，不将其归因于上述 RuoYi 源码已经完成。

**验收边界**：预校验成功不等于最终可以写入，提交仍需检查权限、数据范围、业务状态和并发唯一性。预览结果绑定当前用户和文件摘要、设置有效期，不能接受客户端任意指定可信结果。遇到真实长任务后接入已有方案中的任务中心，不为少量数据一开始就强制引入队列。

## 3. 发布版本更新提示与恢复入口

**来源已证明的行为**：Vben 的更新组件定时发出不使用缓存的 HEAD 请求，以 `ETag` 或 `Last-Modified` 判断页面更新；首次记录基准，发现变化后展示刷新提示。组件在页面隐藏时停止、恢复可见时检查，并在卸载时清理；源码跳过 `localhost` 和 `127.0.0.1`。

来源：[Vben check-updates.vue，固定提交](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/layouts/src/widgets/check-updates/check-updates.vue)。

**本模板现状**：已有 `frontend/src/version.ts` 静态 `APP_VERSION`，源码检索未见同类远程版本检测。已有 `frontend/src/views/error/404.vue`，不能把“新增 404”列为缺失能力。

**建议范围**：构建时产出可读取的版本标识，发布后提示“系统已更新，可刷新”；结合未保存表单保护，允许稍后刷新。公共异常页统一覆盖无权限、页面不存在、服务暂不可用，并给出返回、重试或联系支持入口。异常页扩展和未保存保护是本项目建议，不是上述 Vben 文件已经证明的全部行为。

**验收边界**：采用显式构建标识可减少 CDN/反向代理头部差异带来的误报；断网不等于有新版本；后台不可用与账号无权限区分。生产版本检测不能直接用开发热更新效果验收；不能检测到更新便自动刷新并丢弃正在编辑的内容。

## 4. 模块生成向导与接入检查（稳定接口后开展）

**来源已证明的行为**：Nest 官方 resource schematic 根据 REST 等传输类型和 `crud` 选项生成对应模板，支持 DTO、实体、控制器、服务、测试文件，以及查找模块并注册 imports。它提供通用资源骨架，未包含本项目特有的数据范围、权限、菜单或 Excel 规则。

来源：[Nest 官方 resource.factory.ts，固定提交](https://github.com/nestjs/schematics/blob/016ae501069f96ff504e2ae0576039a70daa4beb/src/lib/resource/resource.factory.ts)。

**本模板现状**：已有 `@nestjs/cli` 与 `@nestjs/schematics` 开发依赖，`scripts` 目录当前只有 `backup.sh`，尚未见模板专用模块生成脚本。仓库约定已有复制示例模块时的完整更名清单，应以该约定为依据。

**建议范围**：先提供本地命令行生成预览和接入检查，输入模块名、实体表名、路由、权限前缀、scopeKey、菜单名、页面存储 key 与 Excel 列，输出后端骨架、遵循现有列表和详情交互的页面、SQL 增量草稿以及测试位置。初版可只覆盖已稳定示例，不建设在线低代码平台，也不自动猜测业务状态和审批规则。

**验收边界**：生成前检查冲突，默认不覆盖已有文件；生成结果可审查，不自动执行 SQL。对权限码、scopeKey、旧示例字段残留及前后端路由做检查；一个生成出的新模块需完成真实列表、详情、新增修改、删除和导出验证，构建成功不等于业务接入完成。后端生成器本身已存在，因此新增点是“本模板接入规则的生成与检查”，不是安装 Nest CLI。

## 总方案合并建议

- 接口合同归入“开发与交付基础”，不必作为普通用户可见菜单。
- 导入模板、预校验和明细归并已有“导入导出与任务”条目，避免重复计数。
- 发布版本提示归入“全局交互与运行反馈”，与草稿保护联动。
- 模块生成归入“模板复制与新业务接入”，优先保证公共接口稳定和接入规范完整。

本轮仅做源文件阅读与文档整理，没有运行应用测试；不以来源项目功能存在推断本模板已经实现。
