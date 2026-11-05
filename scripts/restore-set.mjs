#!/usr/bin/env node
// 隔离恢复工具（第三批 03）：把完整备份集合恢复到【新建隔离库 + 空目录】。
// 用法：
//   node scripts/restore-set.mjs --backup <backupId> --database base_template_test_<纯数字> \
//     --attachments-dir <空目录> --public-dir <空目录> [--allow-migration-mismatch]
// 安全契约（set-format §5/§7/§8）：触碰目标前完成全部预检；目标必须是隔离库命名且不存在；
// 目录为空且与源/备份目录互不嵌套；损坏/缺文件/非 complete 集合直接拒绝；日志不含口令。
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import mysql from '../backend/node_modules/mysql2/promise.js';
import {
  BackupToolError, FORMAT_VERSION, FULL_SET_DIR_RE, LOCK_NAME, MANIFEST_NAME,
  acquireBackupLock, assertNotNested, gunzipSmoke, sha256File,
} from './lib/backup-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(root, 'backend');
try { process.loadEnvFile(resolve(backendDir, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 backend/.env'); }

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

function sanitize(message) {
  return String(message?.message ?? message ?? '未知错误')
    .replace(/(password|passwd|secret|token)\s*=\s*\S+/gi, '$1=***');
}

async function main() {
  const backupId = option('backup');
  const database = option('database');
  const attachmentsDir = option('attachments-dir');
  const publicDir = option('public-dir');
  for (const [name, value] of [['backup', backupId], ['database', database], ['attachments-dir', attachmentsDir], ['public-dir', publicDir]]) {
    if (!value) throw new BackupToolError(`缺少必填参数 --${name}`);
  }
  if (!FULL_SET_DIR_RE.test(backupId)) throw new BackupToolError('备份集合 ID 格式非法');
  // 隔离目标硬约束：命名与现库隔离，绝不接受默认生产连接目标
  if (!/^base_template_test_\d+$/.test(database)) throw new BackupToolError('恢复目标必须是隔离库命名（base_template_test_<纯数字>），拒绝其他目标');
  if (database === process.env.DB_DATABASE) throw new BackupToolError('恢复目标不能等于当前配置的 DB_DATABASE（生产/开发库）');

  const backupDir = resolve(process.env.BACKUP_DIR || resolve(root, 'backups'));
  const setDir = resolve(backupDir, backupId);
  const sourcePrivate = resolve(backendDir, process.env.ATTACHMENT_PRIVATE_DIR || 'uploads-private');
  const sourcePublic = resolve(backendDir, process.env.UPLOAD_DIR || 'uploads');

  // ---- 预检 1：集合完整性与校验和（触碰任何目标之前） ----
  const manifestPath = join(setDir, MANIFEST_NAME);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw new BackupToolError('集合缺失 manifest 或已损坏，拒绝恢复'); }
  if (manifest.formatVersion !== FORMAT_VERSION) throw new BackupToolError(`manifest 版本不兼容（${manifest.formatVersion} ≠ ${FORMAT_VERSION}），拒绝恢复`);
  if (manifest.state !== 'complete') throw new BackupToolError(`集合状态为 ${manifest.state ?? 'corrupt'}，只有 complete 集合可作为恢复点`);
  for (const file of manifest.files ?? []) {
    const path = join(setDir, file.path);
    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) throw new BackupToolError(`集合缺文件：${file.path}`);
    if (info.size !== file.bytes) throw new BackupToolError(`集合文件大小不符：${file.path}`);
    if (await sha256File(path) !== file.sha256) throw new BackupToolError(`集合文件校验和不符（可能损坏）：${file.path}`);
  }
  await gunzipSmoke(join(setDir, 'database.sql.gz')).catch(() => { throw new BackupToolError('数据库转储无法解压（可能损坏），拒绝恢复'); });

  // ---- 预检 2：迁移版本兼容（与代码 docs/sql 清单对照） ----
  const sqlDir = resolve(root, 'docs/sql');
  const codePatchNames = (await readdir(sqlDir).catch(() => null) ?? [])
    .filter(name => name.endsWith('.sql')).sort();
  if (codePatchNames.length) {
    const setPatches = [...(manifest.migrations ?? [])].sort();
    const same = codePatchNames.join('|') === setPatches.join('|');
    if (!same && !flag('allow-migration-mismatch')) {
      throw new BackupToolError('集合迁移版本与当前代码补丁清单不一致；确需继续请显式携带 --allow-migration-mismatch（建议按备份对应版本启动应用）');
    }
  }

  // ---- 预检 3：目标隔离性 ----
  const targets = [
    { path: resolve(attachmentsDir), label: '附件目标目录' },
    { path: resolve(publicDir), label: '公开上传目标目录' },
  ];
  for (const target of targets) {
    const existing = await readdir(target.path).catch(() => null);
    if (existing && existing.length) throw new BackupToolError(`${target.label}（${target.path}）非空，拒绝覆盖既有内容`);
    assertNotNested(target.path, backupDir, target.label, '备份目录');
    assertNotNested(target.path, sourcePrivate, target.label, '附件私有源根');
    assertNotNested(target.path, sourcePublic, target.label, '公开上传源根');
  }
  if (targets[0].path === targets[1].path) throw new BackupToolError('附件目标与公开上传目标不能是同一目录');

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root', password: process.env.DB_PASSWORD || '',
  });
  try {
    const [existing] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if (existing.length) throw new BackupToolError(`隔离库 ${database} 已存在，拒绝覆盖`);

    // ---- 预检全部通过：获取共享锁并执行 ----
    const lock = await acquireBackupLock(resolve(backupDir, LOCK_NAME), { host: 'localhost', pid: process.pid });
    const startedAt = Date.now();
    let databaseCreated = false;
    const createdDirs = [];
    try {
      await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
      databaseCreated = true;

      // 导入转储：mysql 客户端子进程，口令走 MYSQL_PWD，不进命令行/日志
      await importDump(join(setDir, 'database.sql.gz'), database);

      // 恢复文件树（逐项 sha 复验后落盘）
      let restoredFiles = 0;
      for (const target of targets) {
        await mkdir(target.path, { recursive: true });
        createdDirs.push(target.path);
      }
      for (const file of manifest.files) {
        if (file.path === 'database.sql.gz') continue;
        const [prefix, ...rest] = file.path.split('/');
        const rel = rest.join('/');
        if (!rel) continue;
        const destRoot = prefix === 'attachments' ? targets[0].path : targets[1].path;
        const dest = join(destRoot, rel);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(setDir, file.path), dest);
        if (await sha256File(dest) !== file.sha256) throw new BackupToolError(`恢复后校验和不符：${file.path}`);
        restoredFiles += 1;
      }

      // 数据侧核验：核心表行数（内容抽样由 04 演练/应用验证补足）
      const rowCounts = {};
      for (const table of ['users', 'example_items', 'attachments', 'system_logs']) {
        try {
          const [rows] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.${table}`);
          rowCounts[table] = Number(rows[0].n);
        } catch { rowCounts[table] = null; }
      }

      const report = {
        backupId, database,
        attachmentsDir: targets[0].path, publicDir: targets[1].path,
        restoredFiles, rowCounts,
        durationMs: Date.now() - startedAt,
      };
      process.stdout.write(JSON.stringify(report) + '\n');
      process.stdout.write([
        '隔离启动提示（不要用于生产）：',
        `  DB_DATABASE=${database}`,
        `  ATTACHMENT_PRIVATE_DIR=${targets[0].path}`,
        `  UPLOAD_DIR=${targets[1].path}`,
        '  JWT_SECRET=<使用新的随机值，勿复用备份时会话密钥>',
        '  对外通知/真实凭据/调度保持关闭；验证完成后按演练手册清理隔离资源。',
      ].join('\n') + '\n');
    } catch (error) {
      // 执行失败：清理本次创建的隔离资源（库与目录均为本工具新建）
      if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
      for (const dir of createdDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    } finally {
      await lock.release();
    }
  } finally {
    await admin.end();
  }
}

function importDump(gzipPath, database) {
  const client = spawn(process.env.MYSQL_BIN || 'mysql', [
    `--host=${process.env.DB_HOST || 'localhost'}`, `--port=${process.env.DB_PORT || '3306'}`,
    `--user=${process.env.DB_USERNAME || 'root'}`, '--default-character-set=utf8mb4', database,
  ], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  client.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
  const pumped = pipeline(createReadStream(gzipPath), createGunzip(), client.stdin);
  return new Promise((done, fail) => {
    client.once('error', () => fail(new BackupToolError('无法启动 mysql 客户端，请检查 MYSQL_BIN 和执行权限')));
    client.once('close', code => code === 0 ? done() : fail(new BackupToolError(`转储导入失败（mysql 退出码 ${code}）：${stderr.replace(/(password|passwd|secret)\s*=\s*\S+/gi, '$1=***') || '无附加输出'}`)));
    pumped.catch(fail);
  });
}

main().catch(error => {
  process.stderr.write(`${sanitize(error)}\n`);
  process.exitCode = 1;
});
