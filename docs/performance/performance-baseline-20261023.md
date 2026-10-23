# 性能基线（2026-10-23）

F38 首次基线采集。目的：在进一步组件/索引改动前留档，供后续对照。**只测量，本批未做优化改动。**

## 环境

- 后端：本机隔离一次性库（`base_template_b28_*`），Node v24.19，MySQL 8.4，localhost 回环；数据规模 example_items 10000 行（标题/状态/时间分布模拟真实分布）。
- 前端：生产构建经 vite preview 提供；浏览器为 ZCode 内嵌 Chromium（Electron），1280×800。该浏览器不暴露 paint 条目，首屏以 DOMContentLoaded 为口径。
- 复现：`node scripts/perf-baseline.mjs --scale 10000 --base http://localhost:<port>/api/v1 --out docs/performance`（脚本有一次性库守卫，拒绝在非 `base_template_b*/test_*` 命名的库上播种）；浏览器项由自动化会话采集（脚本化项见 `perf-frontend.json`）。

## API 时延（每场景预热 2 次后测 10 次，导出单次）

| 场景 | median | p95 | min | max |
|---|---|---|---|---|
| 列表默认第一页 | 22ms | 36ms | 13ms | 36ms |
| 深分页第 1000 页 | 32ms | 50ms | 21ms | 50ms |
| 关键词筛选 | 29ms | 42ms | 21ms | 42ms |
| 状态筛选 | 29ms | 34ms | 14ms | 34ms |
| 组合筛选+排序 | 31ms | 37ms | 23ms | 37ms |
| 单条详情 | 11ms | 17ms | 4ms | 17ms |
| 筛选导出（全量匹配约 2500 行） | 164ms（单次） | — | — | 739KB |

## 执行计划与实际索引（以数据库为准）

- 实际索引：`PRIMARY(id)`、`IDX(title)`、`IDX(status)`。**updated_at / created_at / owner_id / deleted_at 无索引**（deleted_at 为软删除过滤条件，每查询必带）。
- 计划：默认列表与深分页 `type=ALL`（全表扫描后排序，LIMIT/OFFSET 在 1 万行下无感）；关键词 `LIKE '%…%'` 双侧通配全表扫描；创建时间区间全表扫描；状态筛选走 `IDX(status)`（ref，≈2500 行）。

### 看点（供后续按需优化，不在本批实施）

1. 数据量到 10 万行级时，深分页 OFFSET 与 `ORDER BY updated_at DESC` 全表排序将线性恶化；届时优先考虑 `(deleted_at, updated_at)` 复合索引或游标分页。
2. 关键词双侧通配 LIKE 无索引可用；行数放大后如需全文检索再评估（当前规模无感）。
3. 列表接口每页仅 10 行，DOM 规模有界——**不需要虚拟滚动**（方案允许的"无瓶颈不强加"成立）。

## 前端

- 首屏（生产构建，二次加载有缓存）：DOMContentLoaded 196ms（冷 1752ms）；传输 14KB/49 资源。FCP 条目在该内嵌浏览器不可用。
- 路由切换到列表数据完全渲染：324–430ms（含懒加载 chunk + 列表 API；已缓存首访 21ms）。
- 泄漏指标：**结论已由 2026-10-23 复测修正为无泄漏**。首次基线的堆上行（88→338MB）经 140 次切换的带探针复测推翻：`usedJSHeapSize` 在 20.5–48MB 区间震荡并多次回落到低于起点（36.3MB），DOM 节点全程恒定 451；页面内监听器/定时器/观察器探针的净变化均可由"随 DOM 回收的组件内监听器 + 探针只计创建"解释，代码侧核对（StickyScrollBar/useResizableColumns/useUnsavedChanges/useTableScrollY/useRecentVisits）清理纪律完好。首次基线的"上行"为 V8 工作集扩张与 GC 节奏噪声，不构成滞留。

## 与验收门槛的对照（方案 §9 F38）

| 门槛 | 结果 |
|---|---|
| 留存测量与数据规模 | 已留存（本文件 + perf-api.json + perf-frontend.json + 可复现脚本） |
| 无持续累积的请求/监听器 | **通过**（140 次切换堆稳定 20.5–48MB 区间、DOM 恒定、探针净变化可解释；见上文修正结论） |
| 列宽、固定列、焦点、打印/导出无退化 | 本批未改任何组件代码，此前批次验收口径继续有效 |
| 无瓶颈不强加虚拟化 | 成立（分页有界 + 全部场景 p95 < 60ms @1 万行） |
