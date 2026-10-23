# API 性能基线（2026/10/23）

- 数据规模：example_items 10000 行；每场景预热 2 次后测 10 次（导出单次）。环境：v24.19.0，localhost。
- 实际索引：PRIMARY(id) [unique]、IDX_3313f0c18f791c9aa635dc5b47(title)、IDX_34bc1d9b56357c5f8bf841418b(status)

| 场景 | median | p95 | min | max |
|---|---|---|---|---|
| 列表默认第一页 | 17ms | 28ms | 15ms | 28ms |
| 深分页第1000页 | 27ms | 33ms | 21ms | 33ms |
| 关键词筛选 | 32ms | 38ms | 25ms | 38ms |
| 状态筛选 | 28ms | 33ms | 19ms | 33ms |
| 组合筛选+排序 | 21ms | 35ms | 10ms | 35ms |
| 单条详情 | 15ms | 18ms | 13ms | 18ms |
| 筛选导出(全量匹配行, 单次) | 222ms | 222ms | 222ms | 222ms |

## 执行计划摘要

- 默认列表（按更新时间倒序第一页）: type=ALL key=- rows≈10000 (Using where; Using filesort)
- 深分页（第 1000 页）: type=ALL key=- rows≈10000 (Using where; Using filesort)
- 状态筛选: type=ref key=IDX_34bc1d9b56357c5f8bf841418b rows≈2500 (Using where; Using filesort)
- 关键词模糊匹配: type=ALL key=- rows≈10000 (Using where; Using filesort)
- 创建时间区间: type=ALL key=- rows≈10000 (Using where; Using filesort)
- 计数: type=ALL key=- rows≈10000 (Using where)