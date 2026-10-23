#!/usr/bin/env node
// F13 数据库升级版本管理：docs/sql 增量补丁的账本与执行器。
// 需 Node 20.12+（process.loadEnvFile）。补丁文件名必须形如 YYYYMMDD-<slug>.sql，按文件名即时间顺序执行。
//
// 用法：
//   node scripts/migrate.mjs status                      查看账本：已应用/待执行/文件被修改
//   node scripts/migrate.mjs up [--skip-backup]          备份数据库后按顺序执行待执行补丁并记账
//   node scripts/migrate.mjs mark-applied [--yes] [名称…] 把补丁记为已应用而不执行（仅供全新库：
//       synchronize+seed 已含全部结构，或旧库此前手工执行过补丁时补记账）
//
// 约定：补丁自身负责幂等与事务（见 docs/sql/README.md 每个补丁的回滚说明）；
// 执行器不做二次包裹，成功一个记一条，失败即停并保留已执行记录。
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import mysql from '../backend/node_modules/mysql2/promise.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patchDir = resolve(root, 'docs/sql');
const ledgerTable = 'schema_migrations';
const patchPattern = /^\d{8}-[a-z0-9-]+\.sql$/;

try { process.loadEnvFile(resolve(root, 'backend/.env')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 backend/.env'); }
const database = process.env.DB_DATABASE || 'app_starter';
if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('数据库名只能包含字母、数字和下划线');

const [command = 'status', ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const names = args.filter((a) => !a.startsWith('--'));

function listPatches(entries) {
  return entries.filter((name) => patchPattern.test(name)).sort();
}

async function main() {
  const files = listPatches(await readdir(patchDir));
  if (!files.length) throw new Error('docs/sql 下没有符合 YYYYMMDD-<slug>.sql 命名的补丁');
  const checksums = new Map();
  for (const name of files) checksums.set(name, createHash('sha256').update(await readFile(resolve(patchDir, name))).digest('hex'));

  connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root', password: process.env.DB_PASSWORD || '',
    multipleStatements: true, database,
  });

  const ensureLedger = async () => {
    await connection.query(`CREATE TABLE IF NOT EXISTS \`${ledgerTable}\` (
      name VARCHAR(191) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已执行的数据库结构/数据补丁账本（F13）'`);
  };

  const appliedRows = async () => {
    const [rows] = await connection.query(`SELECT name, checksum, applied_at FROM \`${ledgerTable}\` ORDER BY name`);
    return new Map(rows.map((row) => [row.name, row]));
  };

  if (command === 'status') {
    await ensureLedger();
    const applied = await appliedRows();
    for (const name of files) {
      const row = applied.get(name);
      if (!row) console.log(`待执行   ${name}`);
      else if (row.checksum !== checksums.get(name)) console.log(`已应用(文件已修改) ${name}  applied=${row.applied_at.toISOString()}`);
      else console.log(`已应用   ${name}  applied=${row.applied_at.toISOString()}`);
    }
    for (const name of applied.keys()) if (!files.includes(name)) console.log(`账本多余   ${name}（docs/sql 中已无此文件）`);
    const pending = files.filter((name) => !applied.has(name));
    console.log(`\n共 ${files.length} 个补丁：已应用 ${files.length - pending.length}，待执行 ${pending.length}`);
  } else if (command === 'up') {
    await ensureLedger();
    const applied = await appliedRows();
    const pending = files.filter((name) => !applied.has(name));
    if (!pending.length) { console.log('无待执行补丁，数据库已是最新。'); await connection.end(); return; }
    console.log(`待执行 ${pending.length} 个补丁：${pending.join(', ')}`);

    if (!flags.has('--skip-backup')) {
      const backup = await dumpDatabase();
      if (backup.ok) console.log(`已备份：${backup.file}`);
      else {
        await connection.end();
        throw new Error(`执行前备份失败（${backup.error}）。请先运行 scripts/backup.mjs 确认可备份，或确认无需备份后加 --skip-backup 重试。`);
      }
    } else {
      console.log('已按 --skip-backup 跳过执行前备份。');
    }

    for (const name of pending) {
      const sql = await readFile(resolve(patchDir, name), 'utf8');
      process.stdout.write(`执行 ${name} … `);
      try {
        await connection.query(sql);
      } catch (error) {
        console.log('失败');
        console.error(`补丁 ${name} 执行失败：${error.message}`);
        console.error('该补丁若自带事务已自动回滚；否则请按 docs/sql/README.md 对应回滚说明处理，并核实数据库状态后重试。');
        await connection.end();
        process.exitCode = 1;
        return;
      }
      await connection.query(`INSERT INTO \`${ledgerTable}\` (name, checksum) VALUES (?, ?)`, [name, checksums.get(name)]);
      console.log('完成并记账');
    }
    console.log('全部补丁执行完毕。请按 docs/sql/README.md 部署对应代码版本并做回归验收。');
  } else if (command === 'mark-applied') {
    await ensureLedger();
    const applied = await appliedRows();
    const targets = names.length ? names : files;
    for (const name of targets) {
      if (!patchPattern.test(name)) throw new Error(`名称不符合补丁命名：${name}`);
      if (!files.includes(name)) throw new Error(`docs/sql 中不存在补丁：${name}`);
      if (applied.has(name)) { console.log(`跳过（已在账本） ${name}`); continue; }
      if (!flags.has('--yes')) throw new Error('mark-applied 会把未执行过的补丁记为已应用，仅适用于结构已是最新的数据库。确认请加 --yes。');
      await connection.query(`INSERT INTO \`${ledgerTable}\` (name, checksum) VALUES (?, ?)`, [name, checksums.get(name)]);
      console.log(`已记账（未执行） ${name}`);
    }
  } else {
    throw new Error(`未知命令：${command}。可用命令：status / up / mark-applied`);
  }
  await connection.end();
}

/** 执行前备份：gzip 原子落盘到 BACKUP_DIR（默认 backups/），失败即中止升级。 */
async function dumpDatabase() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const directory = resolve(process.env.BACKUP_DIR || resolve(root, 'backups'));
  const file = resolve(directory, `pre-migrate-${database}-${stamp}.sql.gz`);
  await mkdir(directory, { recursive: true });
  const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', [
    `--host=${process.env.DB_HOST || 'localhost'}`, `--port=${process.env.DB_PORT || '3306'}`,
    `--user=${process.env.DB_USERNAME || 'root'}`, '--single-transaction', '--routines', '--triggers', database,
  ], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolveExit, reject) => {
    dump.once('close', (code) => code === 0 ? resolveExit() : reject(new Error('mysqldump 退出码 ' + code)));
    dump.once('error', (error) => reject(new Error('无法启动 mysqldump：' + error.message)));
  });
  try {
    await Promise.all([exited, pipeline(dump.stdout, createGzip(), createWriteStream(file, { flags: 'wx', mode: 0o600 }))]);
    const info = await stat(file);
    return info.size > 0 ? { ok: true, file } : { ok: false, error: '备份文件为空' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

let connection;
main().catch(async (error) => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (connection) await connection.end().catch(() => {}); });
