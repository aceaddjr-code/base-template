# 基础功能新增建议与 GitHub 参考

> 已整合进[基础模板优化总方案](base-template-optimization-plan-20261020.md)。本文保留功能参考及适配边界；当前范围、优先级和实施批次以总方案为准。

核对日期：2026-10-20。本次只补充功能建议及来源，没有修改应用代码。与上一份 `public-capabilities-review-20261020.md` 中的附件、异步任务、事务、审计、迁移、会话、筛选和回收站建议分开。

## 建议新增的八项功能

| 批次 | 新增功能 | 用户获得的能力 | 第一版范围 |
|---|---|---|---|
| 第一批 | 全局菜单搜索 | 输入“用户”“字典”等关键词直接进入功能，减少寻找菜单 | Ctrl/Cmd+K、名称及别名搜索、键盘跳转，仅检索当前账号可访问入口 |
| 第一批 | 自助修改密码 | 用户在个人中心完成改密，减少管理员代办 | 校验旧密码、新密码确认、后端修改并使旧会话失效；保持已确定的最短 3 位规则 |
| 第一批 | 系统参数管理 | 管理员在界面修改系统名称、帮助联系方式等 | 登记允许配置项、类型校验、操作权限、修改记录和生效方式 |
| 第一批 | 系统公告 | 统一发布维护通知和操作说明，用户可随时回看 | 公告草稿、发布/撤回、首页展示、历史列表；受众范围和阅读回执后续按需求增加 |
| 第二批 | 表单防丢失与草稿恢复 | 误关弹窗或切换页面时不会轻易丢掉长表单输入 | 先加未保存提醒，再对确有需求的长表单提供明确的保存/恢复草稿入口 |
| 第二批 | 单据打印及保存 PDF | 将详情整理成可归档、签字或分享的纸面格式 | A4 打印视图、长文本换行、分页、浏览器保存 PDF；保持权限和数据范围一致 |
| 第二批 | 帮助中心与更新记录 | 用户能找到操作指南、常见问题和版本变化 | 固定帮助入口、按页面关联说明、版本更新记录；第一版可维护 Markdown，无需富文本 CMS |
| 第二批 | 页面水印 | 业务截图可识别来源 | 按需显示姓名/时间/系统名称，可调整透明度；默认不遮挡表格阅读 |

批次表示本项目的建议取舍，并非引用项目的排序或已经确认的实施计划。优先做前四项，功能边界明确、可独立交付。表单草稿和帮助中心是基于本项目的适配建议，本次没有从下述外部源码证明完整现成功能。

## 当前项目对照

- `frontend/src/layouts/BasicLayout.vue` 当前有导航、面包屑、通知和账号入口，没有全局菜单搜索入口；系统名称读取 `VITE_APP_NAME`。`frontend/src/views/home/index.vue` 已有最近访问和按权限显示的模块入口，因此不把它们列为待新增功能。
- `frontend/src/components/ProfileDrawer.vue:40` 明确提示重设密码联系管理员。`backend/src/modules/auth/auth.controller.ts` 只有个人资料读写等入口，`auth.service.ts:309` 自助修改白名单仅为 phone/email/avatar；自助改密需要独立、受认证保护的后端入口，不能把 password 加入资料通用更新。
- `backend/src/modules/system/notification.service.ts` 当前是按用户写入通知、收件箱、未读数和标已读；`system.module.ts` 没有公告或系统参数的实体/控制器。公告需要自身的发布状态和读取规则，现有收件箱可作为后续提醒入口。
- `frontend/src/components/DetailDrawer.vue` 已有独立内存编辑草稿及保存失败保留逻辑，关闭事件直接关闭抽屉。本次检索未发现 beforeunload、onBeforeRouteLeave 或持久化恢复流程，建议新增的是离开提醒及可恢复草稿，不重做现有编辑态。
- 本次在 `frontend/src` 和 `backend/src` 检索未找到打印、水印和帮助中心的完整入口。结论是源码功能盘点，不代表已经对运行服务逐项完成 UI 验收。

草稿按账号、表单、记录隔离，成功提交后清理；密码和敏感字段不写入浏览器草稿。恢复编辑既有记录时，应检查当前权限与记录版本。参数配置只开放受登记的运营项，不开放任意服务器配置。公告富文本若采用 HTML，需清理不受信任内容；首版可用纯文本或受控 Markdown。

下面的一手来源均通过 GitHub connector 搜索后读取源码，链接固定到本次读取的提交。源码行为和本项目的建议分别说明。

## 1. 全局菜单搜索与快捷键

- 参考：[Vben 全局搜索组件](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/layouts/src/widgets/global-search/global-search.vue)、[搜索面板](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/layouts/src/widgets/global-search/search-panel.vue)。
- 源码实际提供：Ctrl/Cmd+K 打开搜索；对传入菜单名称进行字符间模糊匹配；方向键选择、Enter 跳转、Esc 关闭；保存搜索历史。
- 适配建议：搜索当前用户有权限的菜单，补常见中文别名；可先做入口搜索，不直接扩成跨业务全文搜索。历史记录应按账号隔离，并随权限变更过滤；参考实现的历史 key 只有 hostname，不能照搬后声称已经隔离账号。

## 2. 系统公告管理

- 参考：[RuoYi 通知公告控制器](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/notice/NoticeController.java)。
- 源码实际提供：独立公告模块的创建、修改、删除、批量删除、分页、详情；每个管理入口有权限码；可通过 WebSocket 向在线管理端用户推送公告。
- 适配建议：作为管理维护通知、操作说明和版本变更的统一入口，与针对个人的站内通知区分。第一版做公告发布和首页阅读即可。该控制器的 push 只覆盖在线用户，不能据此宣称可靠离线送达、指定部门受众、有效期或已读回执已经实现；这些若需要，应独立定义规则和数据结构。

## 3. 系统参数管理

- 参考：[RuoYi 参数配置控制器](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/config/ConfigController.java)。
- 源码实际提供：参数配置增删改查、分页及导出；按 key 获取参数值；当参数 visible 为 false 时禁止通过取值接口返回前端；管理操作有权限码。
- 适配建议：集中维护系统名称、帮助联系方式、页脚文本和业务默认值等可运营配置。参数应登记类型、允许值和前后端可见性，修改后明确生效及缓存刷新方式。数据库密码、JWT 密钥等部署密钥继续使用环境配置，不作为普通系统参数下发。

## 4. 单据及报表打印

- 参考：[pure-admin 打印工具](https://github.com/pure-admin/vue-pure-admin/blob/fae75ad1cd52d11a7279931ef5bba2b80e363c7b/src/utils/print.ts)、[表格、图表、图片打印示例](https://github.com/pure-admin/vue-pure-admin/blob/fae75ad1cd52d11a7279931ef5bba2b80e363c7b/src/views/able/print/index.vue)。
- 源码实际提供：选择页面 DOM 区域，复制样式和表单当前值，将 canvas 转成图片，经 iframe 调用浏览器打印。
- 适配建议：为详情建立干净的打印视图，支持 A4、长文本换行和分页，浏览器打印对话框可由用户选择保存 PDF。打印列表需说明是当前页、勾选项还是全部结果；虚拟滚动或分页页面不能直接截取 DOM 后声称已经包含全部数据。此证据并不是服务端 PDF、正式套打或模板设计器的实现。

## 5. 页面水印

- 参考：[Vben 水印 hook](https://github.com/vbenjs/vue-vben-admin/blob/61c07936c73b88fbcd1295958f443493cba825fc/packages/effects/hooks/src/use-watermark.ts)。
- 源码实际提供：延迟加载 watermark-js-plus，创建、修改和销毁水印；可配置文字、透明度、旋转和布局，并在组件卸载时清理。
- 适配建议：按页面需要显示姓名、时间或系统名称等轻量水印，保持表格可读。页面水印用于提示和截图辨识，不替代权限、下载授权和字段脱敏；导出文件需要水印时必须另行处理。

## 6. 用户自助修改密码

- 参考：[RuoYi 个人中心控制器](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/UserProfileController.java)、[用户服务的自助改密方法](https://github.com/YunaiV/ruoyi-vue-pro/blob/ac022b15a094cf9cf82903d429b9729e72309da5/yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/service/user/AdminUserServiceImpl.java#L231-L238)。
- 源码实际提供：从当前登录身份取得用户 ID，提供独立 update-password 入口；服务端校验旧密码，并编码保存新密码。
- 适配建议：个人中心新增旧密码、新密码及确认输入；后端继续使用 bcrypt，复用现有 tokenVersion 失效机制，完成后重新登录。管理员重置与本人改密分别处理，密码不进入日志和草稿。参考这两个文件不等于已经证明对方在此方法内撤销全部会话；会话失效是本项目的实施建议。

## 取舍原则

参考功能形态和交互即可，不需要整体引入外部后台框架。跨业务共享能力仍遵守本项目的两处真实调用方约定；新增权限、数据范围和敏感内容裁决继续由后端承担。公告、参数等具有自身数据和规则的功能放在独立模块中。
