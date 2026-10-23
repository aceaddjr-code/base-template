#!/usr/bin/env node
// F10 恢复演练：对一次性库走应用自身的备份路径（BackupService → scripts/backup.mjs → mysqldump），
// 然后模拟灾难（删库 + 删附件文件），用备份恢复数据库与附件文件，逐项核验并记录耗时。
// 只对一次性命名的一次性库执行（守卫同 perf-baseline）。
//
// 前置：backend 已构建（dist/main.js）；MYSQL_BIN 指向 mysql 客户端（默认 'mysql'）；
//       mysqldump 由 backup.mjs 解析（MYSQLDUMP_BIN 或 PATH）。
// 用法：node scripts/recovery-drill.mjs [--port 3032] [--out docs/validation/recovery]
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';

/** 递归列出目录下的全部文件（附件按年/月子目录存放） */
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(root, 'backend');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const PORT = Number(option('port', 3032));
const outDir = resolve(root, option('out', 'docs/validation/recovery'));
try { process.loadEnvFile(resolve(backendDir, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const database = process.env.DB_DATABASE || 'app_starter';
if (!/^base_template_(b\d+(_ui)?|drill|test)_\d+$/.test(database)) {
  throw new Error(`DB_DATABASE=${database} 不是一次性命名（base_template_b*/drill/test_<数字>）。演练会 DROP 该库，拒绝执行。`);
}
const base = `http://localhost:${PORT}/api/v1`;
const mysqlBin = process.env.MYSQL_BIN || 'mysql';
const dbCreds = [`--host=${process.env.DB_HOST || 'localhost'}`, `--port=${process.env.DB_PORT || '3306'}`, `--user=${process.env.DB_USERNAME || 'root'}`];
const results = { database, port: PORT, startedAt: new Date().toISOString(), steps: [], checks: [] };
let backend = null;
let cookie = '';

const step = (name, ms, detail) => { results.steps.push({ name, ms, detail }); console.log(`STEP ${name} ${ms != null ? ms + 'ms' : ''} ${detail ? JSON.stringify(detail).slice(0, 200) : ''}`); };
const check = (name, ok, detail) => { results.checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 200) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function api(path, options = {}) {
  const headers = { Cookie: cookie, ...(options.headers || {}) };
  if (options.json !== undefined) { headers['Content-Type'] = 'application/json'; options = { ...options, body: JSON.stringify(options.json) }; }
  const res = await fetch(base + path, { ...options, headers });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const type = res.headers.get('content-type') || '';
  const raw = type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: type.includes('json') && raw && raw.data !== undefined ? raw.data : raw };
}

function startBackend() {
  backend = spawn(process.execPath, ['dist/main.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(PORT), API_DOCS_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  backend.stdout.on('data', (d) => logs.push(d));
  backend.stderr.on('data', (d) => logs.push(d));
  backend.__logs = logs;
}
async function stopBackend() {
  if (!backend) return;
  const proc = backend; backend = null;
  proc.kill();
  await new Promise((r) => proc.on('exit', r));
}
async function waitReady(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(`${base}/health/live`); if (res.status === 200) return; } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('后端未就绪：' + Buffer.concat(backend?.__logs ?? []).toString().slice(-800));
}
async function runMysql(args, input) {
  const res = spawnSync(mysqlBin, [...dbCreds, ...args], { input, encoding: 'buffer', env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, timeout: 300000 });
  if (res.status !== 0) throw new Error(`mysql ${args.join(' ')} 失败: ${res.stderr?.toString().slice(0, 300)}`);
  return res.stdout;
}
async function countTables() {
  const counts = {};
  for (const table of ['users', 'roles', 'menus', 'departments', 'example_items', 'attachments', 'sys_dict_types', 'sys_dict_items']) {
    const rows = await runMysql(['-N', '-e', `SELECT COUNT(*) FROM \`${database}\`.${table}`]);
    counts[table] = Number(rows.toString().trim());
  }
  return counts;
}

async function main() {
  console.log(`恢复演练目标库: ${database}（演练结束会 DROP）`);
  await runMysql(['-e', `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
  // ===== 阶段一：起后端，制造可验证的数据 =====
  startBackend();
  await waitReady();
  const login = await api('/auth/login', { method: 'POST', json: { loginid: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_DEFAULT_PASSWORD } });
  check('setup.login', login.status === 200 || login.status === 201, login.status);
  const stamp = Date.now() % 1000000;
  for (let i = 1; i <= 3; i += 1) {
    const created = await api('/examples/items', { method: 'POST', json: { title: `DRILL-${stamp}-${i}`, status: 'pending', description: '恢复演练数据' } });
    check(`setup.create-item-${i}`, created.status === 200 || created.status === 201, created.status);
  }
  // 附件：约 2KB 的伪 PDF（扩展名在白名单内）
  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n% 恢复演练附件\n'), randomBytes(2048)]);
  const attachmentHash = sha256(pdfBytes);
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), `drill-${stamp}.pdf`);
  const uploaded = await api('/attachments', { method: 'POST', body: form });
  check('setup.upload-attachment', uploaded.status === 200 || uploaded.status === 201, uploaded.status);
  const attachmentId = uploaded.body?.id;
  const privateDir = resolve(backendDir, process.env.ATTACHMENT_PRIVATE_DIR || 'uploads-private');
  let attachmentPath = null;
  for (const f of await listFiles(privateDir)) {
    const buf = await readFile(f);
    if (sha256(buf) === attachmentHash) attachmentPath = f;
  }
  check('setup.attachment-file-located', !!attachmentPath, attachmentPath && attachmentPath.split(/[\\/]/).pop());
  const downloaded = await api(`/attachments/${attachmentId}/download`);
  check('setup.download-roundtrip', downloaded.status === 200 && sha256(downloaded.body) === attachmentHash, downloaded.status);

  const beforeCounts = await countTables();
  step('snapshot-counts', null, beforeCounts);

  // ===== 阶段二：走应用自身备份路径（数据库）+ 文件级备份（附件目录） =====
  const backupStart = Date.now();
  const triggered = await api('/system/backups/backup', { method: 'POST' });
  check('backup.trigger-accepted', triggered.status === 200 || triggered.status === 201, triggered.status);
  let backupFile = null;
  const backupDir = resolve(root, 'backups');
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    const status = await api('/system/backups/status');
    if (status.body?.status === 'failed') throw new Error('备份失败：' + (status.body?.message || ''));
    if (status.body?.status === 'succeeded') {
      const files = (await readdir(backupDir)).filter((f) => f.startsWith(`${database}-`) && f.endsWith('.sql.gz'));
      const withTime = [];
      for (const f of files) withTime.push({ f, mtime: (await stat(resolve(backupDir, f))).mtimeMs });
      withTime.sort((a, b) => b.mtime - a.mtime);
      if (withTime[0]) { backupFile = resolve(backupDir, withTime[0].f); break; }
    }
  }
  check('backup.succeeded', !!backupFile, backupFile && backupFile.split(/[\\/]/).pop());
  const backupMs = Date.now() - backupStart;
  step('backup-database', backupMs, { file: backupFile && backupFile.split(/[\\/]/).pop() });
  // 附件目录文件级备份（当前模板备份能力覆盖数据库；文件由运维按目录备份——演练同样按目录拷贝验证，保留相对结构）
  const attachBackupStart = Date.now();
  const attachmentBackupDir = await mkdtemp(join(tmpdir(), 'drill-attach-'));
  const attachFiles = await listFiles(privateDir);
  for (const f of attachFiles) {
    const relative = f.slice(privateDir.length + 1);
    await mkdir(resolve(attachmentBackupDir, relative, '..'), { recursive: true });
    await copyFile(f, resolve(attachmentBackupDir, relative));
  }
  step('backup-attachment-files', Date.now() - attachBackupStart, { files: attachFiles.length });

  // ===== 阶段三：模拟灾难（停后端 → 删库 → 删附件文件） =====
  await stopBackend();
  const lossStart = Date.now();
  await runMysql(['-e', `DROP DATABASE \`${database}\``]);
  await rm(attachmentPath);
  step('simulate-loss', Date.now() - lossStart, { dropped: database, removedFile: attachmentPath.split(/[\\/]/).pop() });

  // ===== 阶段四：恢复（数据库：gunzip → mysql 导入；附件：目录拷回） =====
  const restoreStart = Date.now();
  await runMysql(['-e', `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]);
  const dump = await mkdtemp(join(tmpdir(), 'drill-'));
  const sqlFile = join(dump, 'restore.sql');
  await pipeline(createReadStream(backupFile), createGunzip(), createWriteStream(sqlFile));
  await new Promise((done, fail) => {
    const proc = spawn(mysqlBin, [...dbCreds, '--default-character-set=utf8mb4', database], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += d });
    createReadStream(sqlFile).pipe(proc.stdin);
    proc.once('close', (code) => code === 0 ? done() : fail(new Error('恢复导入失败: ' + err.slice(0, 300))));
  });
  const restoreDbMs = Date.now() - restoreStart;
  const afterCounts = await countTables();
  check('restore.row-counts-match', JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), { before: beforeCounts, after: afterCounts });
  step('restore-database', restoreDbMs);

  const attachRestoreStart = Date.now();
  const backupFiles = await listFiles(attachmentBackupDir);
  for (const f of backupFiles) {
    const relative = f.slice(attachmentBackupDir.length + 1);
    const target = resolve(privateDir, relative);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(f, target);
  }
  const restoreFilesMs = Date.now() - attachRestoreStart;
  const restoredHash = sha256(await readFile(attachmentPath));
  check('restore.attachment-hash-match', restoredHash === attachmentHash, restoredHash.slice(0, 16));
  step('restore-attachment-files', restoreFilesMs);
  await rm(dump, { recursive: true, force: true });
  await rm(attachmentBackupDir, { recursive: true, force: true });

  // ===== 阶段五：恢复后可用性（重新起后端验证） =====
  const bootStart = Date.now();
  startBackend();
  await waitReady();
  const bootMs = Date.now() - bootStart;
  step('boot-on-restored-db', bootMs);
  cookie = '';
  const relogin = await api('/auth/login', { method: 'POST', json: { loginid: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_DEFAULT_PASSWORD } });
  check('verify.login-after-restore', relogin.status === 200 || relogin.status === 201, relogin.status);
  const list = await api('/examples/items?page=1&pageSize=10&keyword=' + encodeURIComponent(`DRILL-${stamp}`));
  check('verify.drill-items-restored', (list.body?.list || []).length === 3, (list.body?.list || []).map((i) => i.title));
  const redownload = await api(`/attachments/${attachmentId}/download`);
  check('verify.attachment-download-after-restore', redownload.status === 200 && sha256(redownload.body) === attachmentHash, redownload.status);

  results.timings = { backupMs, restoreDbMs, restoreFilesMs, bootMs };
  results.allPassed = results.checks.every((c) => c.ok);
  results.finishedAt = new Date().toISOString();
  const fs = await import('node:fs');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(resolve(outDir, 'recovery-drill.json'), JSON.stringify(results, null, 2));
  // 演练产生的备份文件与附件文件随一次性库一并清理
  if (backupFile) await rm(backupFile, { force: true });
  await rm(attachmentPath, { force: true });
  console.log('ALL-PASSED=' + results.allPassed);
  if (!results.allPassed) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('DRILL-ERROR', error.message);
  results.fatal = error.message;
  results.allPassed = false;
  try {
    const fs = await import('node:fs');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(resolve(outDir, 'recovery-drill.json'), JSON.stringify(results, null, 2));
  } catch { /* 尽力落盘 */ }
  process.exitCode = 1;
}).finally(async () => {
  await stopBackend();
  try {
    await runMysql(['-e', `DROP DATABASE IF EXISTS \`${database}\``]);
    console.log('演练库已删除');
  } catch { /* 清理失败不掩盖主结果 */ }
});
