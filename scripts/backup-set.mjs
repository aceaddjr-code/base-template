#!/usr/bin/env node
// 完整备份集合工具（第三批 02）：停写窗口内产出 数据库转储＋附件树＋manifest 的原子集合。
// 用法：
//   node scripts/backup-set.mjs backup --confirm-quiesced   # 完整集合（必须显式确认已停写）
//   node scripts/backup-set.mjs list                        # 完整集合＋旧 sql.gz 混合列表（JSON）
//   node scripts/backup-set.mjs clean [--dry-run] --yes     # 有界清理（默认 dry-run；保留最近 1 份 complete）
// 契约：.scratch/backup-recovery-phase3/set-format.md。旧 scripts/backup.mjs（仅数据库）保留不动。
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import mysql from '../backend/node_modules/mysql2/promise.js';
import {
  BackupToolError, CLEAN_KEEP_LAST, FAILED_PREFIX, FULL_SET_DIR_RE, LOCK_NAME, MANIFEST_NAME, FORMAT_VERSION, STAGING_PREFIX,
  acquireBackupLock, assertNotNested, atomicRenameDir, buildBackupId, cleanExpired, copyTreeVerified,
  gunzipSmoke, listBackupEntries, writeJson,
} from './lib/backup-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(root, 'backend');
try { process.loadEnvFile(resolve(backendDir, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 backend/.env'); }

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter(a => a.startsWith('--')));
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const env = process.env;

function requireEnvDatabase(database) {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new BackupToolError('数据库名只能包含字母、数字和下划线');
}

function sanitize(message) {
  let text = String(message?.message ?? message ?? '未知错误');
  // 不落任何环境值：常见口令形态兜底剥离
  text = text.replace(/(password|passwd|secret|token)\s*=\s*\S+/gi, '$1=***');
  return text;
}

async function main() {
  if (command === 'list') {
    const backupDir = resolve(env.BACKUP_DIR || resolve(root, 'backups'));
    process.stdout.write(JSON.stringify(await listBackupEntries(backupDir), null, 2) + '\n');
    return;
  }
  if (command === 'clean') {
    const backupDir = resolve(env.BACKUP_DIR || resolve(root, 'backups'));
    const keepDays = Number(env.KEEP_DAYS ?? '30');
    if (!flags.has('--yes') && !flags.has('--dry-run')) {
      throw new BackupToolError('清理需要 --yes（执行）或 --dry-run（预演）之一');
    }
    const result = await cleanExpired(backupDir, keepDays, { dryRun: !flags.has('--yes') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (command === 'copy-offsite') {
    // 本地演练用的“临时异地”副本：复制 complete 集合到独立目录并逐项复验；
    // 真实异地目标/加密/告警由 drafts/05 收集资料后另立任务。
    const backupId = option('backup');
    const target = option('target');
    if (!backupId || !target) throw new BackupToolError('用法：copy-offsite --backup <backupId> --target <目录>');
    if (!FULL_SET_DIR_RE.test(backupId)) throw new BackupToolError('备份集合 ID 格式非法');
    const backupDir = resolve(env.BACKUP_DIR || resolve(root, 'backups'));
    const setDir = resolve(backupDir, backupId);
    const manifest = JSON.parse(await readFile(join(setDir, MANIFEST_NAME), 'utf8'));
    if (manifest.state !== 'complete') throw new BackupToolError('仅 complete 集合可复制异地副本');
    const privateRoot = resolve(backendDir, env.ATTACHMENT_PRIVATE_DIR || 'uploads-private');
    const publicRoot = resolve(backendDir, env.UPLOAD_DIR || 'uploads');
    const destination = resolve(target);
    assertNotNested(destination, backupDir, '异地目录', '备份目录');
    assertNotNested(destination, privateRoot, '异地目录', '附件私有根');
    assertNotNested(destination, publicRoot, '异地目录', '公开上传根');
    const existing = await readdir(destination).catch(() => null);
    if (existing && existing.length) throw new BackupToolError('异地目录非空，拒绝覆盖既有内容');
    const destSet = join(destination, backupId);
    await mkdir(destSet, { recursive: true });
    const { copyFile: copy, stat: statFile } = await import('node:fs/promises');
    const { sha256File } = await import('./lib/backup-lib.mjs');
    let copied = 0;
    for (const file of manifest.files) {
      const from = join(setDir, file.path);
      const to = join(destSet, file.path);
      await mkdir(dirname(to), { recursive: true });
      // 单文件失败重试一次（网络盘/移动介质抖动）；仍失败则中止并保留已复制目录供人工处置
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await copy(from, to);
          if (await sha256File(to) !== file.sha256) throw new Error(`校验和不符：${file.path}`);
          lastError = null;
          break;
        } catch (error) { lastError = error; await rm(to, { force: true }).catch(() => {}); }
      }
      if (lastError) throw new BackupToolError(`异地复制失败（重试一次后仍失败）：${sanitize(lastError)}`);
      copied += 1;
    }
    await writeJson(join(destSet, MANIFEST_NAME), manifest);
    process.stdout.write(JSON.stringify({ backupId, destination, copied }) + '\n');
    return;
  }
  if (command !== 'backup') {
    process.stderr.write('用法：backup --confirm-quiesced | list | clean [--dry-run|--yes]\n');
    process.exitCode = 2;
    return;
  }

  // 停写协议：完整集合必须显式确认（进程外停写：停实例写入口/后台定时器/独立写工具；页面横幅不算）
  if (!flags.has('--confirm-quiesced')) {
    throw new BackupToolError('完整备份要求先完成停写窗口（停止全部实例写入、后台定时器与独立写工具），并携带 --confirm-quiesced 显式确认', 'EQUIESCE');
  }

  const database = env.DB_DATABASE || 'app_starter';
  requireEnvDatabase(database);
  const backupDir = resolve(env.BACKUP_DIR || resolve(root, 'backups'));
  const privateRoot = resolve(backendDir, env.ATTACHMENT_PRIVATE_DIR || 'uploads-private');
  const publicRoot = resolve(backendDir, env.UPLOAD_DIR || 'uploads');
  assertNotNested(backupDir, privateRoot, '备份目录', '附件私有根');
  assertNotNested(backupDir, publicRoot, '备份目录', '公开上传根');

  await mkdir(backupDir, { recursive: true });
  const lock = await acquireBackupLock(resolve(backupDir, LOCK_NAME));
  const startedAt = new Date();
  const backupId = buildBackupId(database, startedAt);
  const staging = resolve(backupDir, STAGING_PREFIX + backupId);
  const target = resolve(backupDir, backupId);
  try {
    await mkdir(staging, { recursive: true });

    // 阶段 1：数据库转储（与 backup.mjs 同参；密码走 MYSQL_PWD 不进命令行）
    const dumpFile = resolve(staging, 'database.sql.gz');
    await dumpDatabase(dumpFile, database);

    // 阶段 2/3：附件两棵树复制＋逐项校验（源在复制期变化即失败＝停写未兑现）
    const attachmentEntries = await copyTreeVerified(privateRoot, resolve(staging, 'attachments'), 'attachments');
    const publicEntries = await copyTreeVerified(publicRoot, resolve(staging, 'public-uploads'), 'public-uploads');

    // 阶段 4：校验＋manifest＋原子发布
    await gunzipSmoke(dumpFile);
    const migrations = await readMigrations(database);
    const dumpStat = await stat(dumpFile);
    const { sha256File } = await import('./lib/backup-lib.mjs');
    const manifest = {
      formatVersion: FORMAT_VERSION,
      backupId,
      state: 'complete',
      createdAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      quiesce: { mode: 'offline-window', confirmQuiesced: true, startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(), stoppedScopes: ['all-instances', 'background-timers', 'standalone-writers'] },
      app: await appIdentity(),
      migrations,
      database: { name: database, dumpFile: 'database.sql.gz', bytes: dumpStat.size, sha256: await sha256File(dumpFile) },
      attachments: { root: 'ATTACHMENT_PRIVATE_DIR', fileCount: attachmentEntries.length, totalBytes: attachmentEntries.reduce((n, e) => n + e.bytes, 0) },
      publicUploads: { root: 'UPLOAD_DIR', fileCount: publicEntries.length, totalBytes: publicEntries.reduce((n, e) => n + e.bytes, 0) },
      files: [
        { path: 'database.sql.gz', bytes: dumpStat.size, sha256: '' }, // 占位，下面回填
        ...attachmentEntries, ...publicEntries,
      ],
      envNames: ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'COOKIE_SECURE', 'CORS_ORIGIN', 'TRUST_PROXY_HOPS', 'UPLOAD_DIR', 'ATTACHMENT_PRIVATE_DIR', 'BACKUP_DIR', 'BACKUP_SCRIPT', 'BACKUP_EXECUTABLE', 'MYSQLDUMP_BIN', 'BACKUP_TIMEOUT_MS', 'KEEP_DAYS', 'AUDIT_RETENTION_DAYS', 'ADMIN_USERNAME', 'ADMIN_DEFAULT_PASSWORD', 'BODY_LIMIT', 'PORT', 'NODE_ENV'],
    };
    manifest.files[0].sha256 = manifest.database.sha256;
    await writeJson(resolve(staging, MANIFEST_NAME), manifest);
    await atomicRenameDir(staging, target);

    const durationMs = Date.now() - startedAt.getTime();
    process.stdout.write(JSON.stringify({ backupId, fileCount: manifest.files.length, bytes: manifest.files.reduce((n, e) => n + e.bytes, 0), durationMs }) + '\n');
  } catch (error) {
    // 失败：写脱敏记录＋清理 staging；不触碰任何既有 complete 集合
    const failedPath = resolve(backupDir, `${FAILED_PREFIX}${backupId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(failedPath, JSON.stringify({ backupId, at: new Date().toISOString(), error: sanitize(error) }, null, 2) + '\n').catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await lock.release();
  }
}

function dumpDatabase(destination, database) {
  const dump = spawn(env.MYSQLDUMP_BIN || 'mysqldump', [
    `--host=${env.DB_HOST || 'localhost'}`, `--port=${env.DB_PORT || '3306'}`,
    `--user=${env.DB_USERNAME || 'root'}`, '--single-transaction', '--routines', '--triggers', database,
  ], { env: { ...env, MYSQL_PWD: env.DB_PASSWORD || '' }, timeout: Math.max(1, Number(env.BACKUP_TIMEOUT_MS || 120000) - 1000), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const streamed = pipeline(dump.stdout, createGzip(), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return new Promise((done, fail) => {
    dump.once('error', () => fail(new BackupToolError('无法启动 mysqldump，请检查 MYSQLDUMP_BIN 和执行权限')));
    dump.once('close', code => code === 0 ? undefined : fail(new BackupToolError('mysqldump 执行失败，请检查数据库连接及备份权限')));
    Promise.all([streamed]).then(() => done()).catch(fail);
  });
}

async function readMigrations(database) {
  const connection = await mysql.createConnection({
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME || 'root', password: env.DB_PASSWORD || '', database,
  });
  try {
    // 开发库由 synchronize 建表时可能没有账本表：按空清单记录并在恢复端提示差异
    try {
      const [rows] = await connection.query('SELECT name FROM schema_migrations ORDER BY name');
      return rows.map(row => String(row.name));
    } catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') return [];
      throw error;
    }
  } finally { await connection.end(); }
}

async function appIdentity() {
  const identity = {};
  try { identity.version = JSON.parse(await readFile(resolve(backendDir, 'package.json'), 'utf8')).version; } catch { /* 版本缺省不阻断 */ }
  identity.gitCommit = null;
  return identity;
}

main().catch(error => {
  process.stderr.write(`${sanitize(error)}\n`);
  process.exitCode = 1;
});
