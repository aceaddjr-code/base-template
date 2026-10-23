# 恢复演练报告（2026-10-23）

F10 恢复验证：**「存在备份文件」升级为「已验证可恢复」**。演练对一次性库走应用自身备份路径，随后模拟灾难并恢复，全程自动化、可重复。

## 演练过程（scripts/recovery-drill.mjs，可重复执行）

1. 一次性库（`base_template_b30_*`）启动后端（synchronize+种子），经 API 制造数据：3 条示例事项 + 1 个私有附件（PDF，记录 SHA-256）。
2. **备份**：走应用自身路径 `POST /system/backups/backup`（BackupService → scripts/backup.mjs → mysqldump，gzip）；附件目录做文件级拷贝（当前模板备份能力覆盖数据库，附件文件由运维按 `ATTACHMENT_PRIVATE_DIR` 目录备份——演练同口径验证）。
3. **模拟灾难**：DROP 整库 + 删除附件文件。
4. **恢复**：重建空库 → gunzip 备份 → `mysql --default-character-set=utf8mb4` 导入；附件目录拷回。
5. **核验**：重新启动后端 → 8 张表行数逐一比对 → admin 重新登录 → 演练数据 3 条可查 → 附件经 API 下载字节一致。

## 结果（base_template_b30_1792741344235，本机 MySQL 8.4）

| 阶段 | 耗时 | 结果 |
|---|---|---|
| 备份数据库（应用路径） | 805ms | .sql.gz 产出 |
| 备份附件目录（2 文件） | 3ms | 哈希留档 |
| 模拟损失（删库+删文件） | 170ms | — |
| **恢复数据库** | **383ms** | 8 表行数逐一匹配 |
| **恢复附件文件** | **2ms** | SHA-256 一致 |
| 恢复后启动 | 1548ms | — |
| 恢复后核验 | — | 登录 ✓ / 事项 3 条 ✓ / 附件下载字节一致 ✓ |

15 项断言全部通过：[recovery-drill.json](../validation/optimization-batch30-20261023/recovery-drill.json)。

## 失败点记录（演练过程中发现并修正的脚本问题）

1. mysql 客户端选项名为 `--default-character-set`（不是 `--default-character`）。
2. 附件目录按年/月分层（`uploads-private/2026/10/`），文件定位与备份/恢复需递归并保留相对结构。
3. 演练脚本需自含建库（上一次失败运行的清理会 DROP 掉库）。

## 复现与运维口径

```bash
# 前置：backend 已构建；一次性命名库由脚本自建自清
DB_DATABASE=base_template_b30_<时间戳> PORT=3032 \
MYSQL_BIN=<mysql 客户端> MYSQLDUMP_BIN=<mysqldump> \
node scripts/recovery-drill.mjs --port 3032
```

- **Windows**：备份执行器默认 `process.execPath`（node 运行 scripts/backup.mjs），依赖 mysqldump/mysql 客户端（可用 `MYSQLDUMP_BIN`/`MYSQL_BIN` 指向 MySQL bin 目录）。
- **Linux**：同一执行器；`apt/yum install mysql-client` 后 PATH 可解析，无需额外配置。
- 附件文件与数据库备份是**两条独立链路**：数据库走应用内备份 API；`ATTACHMENT_PRIVATE_DIR` 目录需按文件级备份策略纳入（演练验证了该链路的可恢复性）。
- 触发条件提醒：演练会 DROP 目标库，脚本已做一次性命名守卫（`base_template_b*/drill/test_<数字>`），对其他库名拒绝执行。
