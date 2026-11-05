// 完整备份集合/隔离恢复共用库（第三批）。纯 Node，无应用依赖；
// mysql2 如需使用由调用方从 backend/node_modules 引入（scripts/ 既有先例）。
// 契约来源：.scratch/backup-recovery-phase3/set-format.md（01 交付）。
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const FULL_SET_DIR_RE = /^[A-Za-z0-9_-]+-full-\d{8}-\d{6}-[0-9A-Za-z]{8}$/;
export const STAGING_PREFIX = '.staging-';
export const FAILED_PREFIX = '.failed-';
export const LOCK_NAME = '.backup-lock';
export const OLD_SQL_RE = /^[A-Za-z0-9_-]+-\d{8}-\d{6}\.sql\.gz$/;
export const MANIFEST_NAME = 'manifest.json';
export const FORMAT_VERSION = 1;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const LOCK_STALE_MS = 60000;
/** 清理永远保留的最近完整集合数量（回退不得删除唯一有效副本）。 */
export const CLEAN_KEEP_LAST = 1;

export class BackupToolError extends Error {
  constructor(message, code = 'EBACKUP') { super(message); this.code = code; }
}

/** 规范化并校验两个目录互不嵌套（含相等）。 */
export function assertNotNested(a, b, labelA, labelB) {
  const na = resolve(a), nb = resolve(b);
  if (na === nb) throw new BackupToolError(`${labelA} 与 ${labelB} 不能是同一目录：${na}`, 'EPATHNEST');
  const rel = relative(nb, na);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    throw new BackupToolError(`${labelA}（${na}）位于 ${labelB}（${nb}）内部，拒绝执行`, 'EPATHNEST');
  }
  const rel2 = relative(na, nb);
  if (rel2 && !rel2.startsWith('..') && !isAbsolute(rel2)) {
    throw new BackupToolError(`${labelB}（${nb}）位于 ${labelA}（${na}）内部，拒绝执行`, 'EPATHNEST');
  }
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((done, fail) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', done);
    stream.on('error', fail);
  });
  return hash.digest('hex');
}

/**
 * 遍历文件树：只接受普通文件与目录；符号链接/重解析点（junction/symlink）、
 * 套接字/设备等其他类型一律失败（集合与清单必须一致，不静默跳过）。
 */
export async function walkTree(root, onEntry) {
  await walkDir(root, '', onEntry);
}

async function walkDir(root, rel, onEntry) {
  for (const name of await readdir(resolve(root, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${name.name}` : name.name;
    if (name.isSymbolicLink()) {
      throw new BackupToolError(`发现符号链接/重解析点，为保证集合一致性已拒绝：${childRel}`, 'EREPARSE');
    }
    let info;
    try { info = await lstat(resolve(root, childRel)); }
    catch (error) { throw new BackupToolError(`无法读取文件 ${childRel}：${error.code ?? error.message}`); }
    if (info.isFile()) { await onEntry(childRel, info); continue; }
    if (info.isDirectory()) { await walkDir(root, childRel, onEntry); continue; }
    throw new BackupToolError(`非普通文件/目录（拒绝打包）：${childRel}`, 'ENOTREGULAR');
  }
}

/**
 * 复制整树并逐项校验：复制前记录源文件身份（dev/ino/大小），
 * 复制后源侧身份未变且两侧大小与 sha256 一致才算成功（停写窗口未兑现即失败）。
 * 返回相对（含前缀）清单条目。
 */
export async function copyTreeVerified(srcRoot, destRoot, prefix) {
  const entries = [];
  await mkdir(destRoot, { recursive: true });
  await walkTree(srcRoot, async (rel, before) => {
    const src = resolve(srcRoot, rel);
    const dest = resolve(destRoot, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    const [srcAfter, destInfo] = await Promise.all([lstat(src), stat(dest)]);
    if (srcAfter.dev !== before.dev || srcAfter.ino !== before.ino) {
      throw new BackupToolError(`复制期间源文件发生变化（停写窗口未兑现）：${rel}`, 'ESRCCHANGED');
    }
    if (srcAfter.size !== before.size || destInfo.size !== before.size) {
      throw new BackupToolError(`复制后大小不一致：${rel}`, 'ESIZEMISMATCH');
    }
    const [srcHash, destHash] = await Promise.all([sha256File(src), sha256File(dest)]);
    if (srcHash !== destHash) throw new BackupToolError(`复制后校验和不一致：${rel}`, 'EHASHMISMATCH');
    entries.push({ path: `${prefix}/${rel}`, bytes: before.size, sha256: srcHash });
  });
  return entries;
}

/** 共享互斥锁：独占创建＋内容标识持有者＋心跳触碰 mtime；陈旧可接管。 */
export async function acquireBackupLock(lockPath, { host = 'localhost', pid = process.pid } = {}) {
  const holder = { host, pid, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify(holder) + '\n');
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const fresh = await lockIsFresh(lockPath);
      if (fresh) {
        let owner = {};
        try { owner = JSON.parse((await readFile(lockPath, 'utf8')).trim()); } catch { /* 持有者记录损坏按未知处理 */ }
        throw new BackupToolError(
          `另一执行器正在备份（持有者 ${owner.host ?? '未知'} pid=${owner.pid ?? '?'}，开始于 ${owner.startedAt ?? '未知'}），已拒绝并发执行`,
          'ELOCKBUSY');
      }
      // 陈旧（心跳超时）：接管前清理旧锁；若清理仍失败则按忙处理
      await unlink(lockPath).catch(() => { throw new BackupToolError('共享锁陈旧但无法清理，请人工检查备份目录', 'ELOCKSTUCK'); });
      continue;
    }
    const timer = setInterval(() => { utimes(lockPath, new Date(), new Date()).catch(() => {}); }, HEARTBEAT_INTERVAL_MS);
    timer.unref();
    return {
      holder,
      async release() {
        clearInterval(timer);
        await unlink(lockPath).catch(() => {});
      },
    };
  }
  throw new BackupToolError('无法获得共享锁', 'ELOCKBUSY');
}

async function lockIsFresh(lockPath) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs <= LOCK_STALE_MS;
  } catch { return false; }
}

/** 供后端服务在内的其他写入方做“只读尊重”：锁新鲜即视为忙。 */
export async function backupLockHeld(lockPath) {
  return lockIsFresh(lockPath);
}

export function buildBackupId(database, now = new Date(), randomHex = null) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const rand = randomHex ?? createHash('sha256').update(`${database}${Date.now()}${process.pid}${Math.random()}`).digest('hex').slice(0, 8);
  return `${database}-full-${stamp}-${rand}`;
}

export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }

/** 列出备份目录内全部可识别条目：完整集合、creating 中 staging、failed 记录与旧 sql.gz。 */
export async function listBackupEntries(backupDir) {
  const entries = [];
  let names = [];
  try { names = await readdir(backupDir); } catch (error) {
    if (error.code === 'ENOENT') return entries;
    throw error;
  }
  for (const name of names) {
    const path = resolve(backupDir, name);
    if (name.startsWith(STAGING_PREFIX)) {
      entries.push({ type: 'full-set', backupId: name.slice(STAGING_PREFIX.length), state: 'creating', date: null });
      continue;
    }
    if (name.startsWith(FAILED_PREFIX) && name.endsWith('.json')) {
      entries.push({ type: 'failed-record', name, date: null });
      continue;
    }
    if (name === LOCK_NAME) continue;
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      const manifestPath = join(path, MANIFEST_NAME);
      const manifestStat = await stat(manifestPath).catch(() => null);
      if (!manifestStat) continue;
      let manifest = null;
      try { manifest = await readJson(manifestPath); } catch { /* 损坏集合按 corrupt 呈现，可清理 */ }
      entries.push({
        type: 'full-set',
        backupId: manifest?.backupId ?? name,
        state: manifest?.state ?? 'corrupt',
        date: manifest?.finishedAt ?? manifest?.createdAt ?? manifestStat.mtime.toISOString(),
        bytes: manifest?.database?.bytes ?? 0,
        fileCount: manifest?.files?.length ?? 0,
        error: manifest?.error ?? null,
      });
      continue;
    }
    if (info.isFile() && OLD_SQL_RE.test(name)) {
      entries.push({ type: 'database-only', filename: name, size: info.size, date: info.mtime.toISOString() });
    }
  }
  return entries;
}

/** 有界清理：仅过期 complete 集合与 24h 前的 failed/staging 残留；永远保留最近 CLEAN_KEEP_LAST 份 complete。 */
export async function cleanExpired(backupDir, keepDays, { dryRun = true } = {}) {
  const cutoff = Date.now() - Number(keepDays) * 86400000;
  const entries = await listBackupEntries(backupDir);
  const complete = entries
    .filter(e => e.type === 'full-set' && e.state === 'complete')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const removable = new Set();
  complete.slice(CLEAN_KEEP_LAST).forEach(e => {
    if (new Date(e.date).getTime() < cutoff) removable.add(e.backupId);
  });
  const actions = [];
  for (const id of removable) actions.push({ action: 'remove-set', target: id });
  for (const e of entries) {
    if (e.type === 'failed-record') {
      const path = resolve(backupDir, e.name);
      if ((await stat(path)).mtimeMs < Date.now() - 86400000) actions.push({ action: 'remove-record', target: e.name });
    }
    if (e.type === 'full-set' && e.state === 'creating') {
      const path = resolve(backupDir, STAGING_PREFIX + e.backupId);
      if ((await stat(path)).mtimeMs < Date.now() - 86400000) actions.push({ action: 'remove-staging', target: e.backupId });
    }
  }
  if (dryRun || !actions.length) return { dryRun, actions };
  for (const item of actions) {
    const path = item.action === 'remove-set'
      ? resolve(backupDir, item.target)
      : item.action === 'remove-staging' ? resolve(backupDir, STAGING_PREFIX + item.target) : resolve(backupDir, item.target);
    await rm(path, { recursive: true, force: true });
  }
  return { dryRun: false, actions };
}

/** 校验 gzip 可解（完整性冒烟；逐文件哈希校验由恢复端做全套）。 */
export async function gunzipSmoke(gzipPath) {
  const { createGunzip } = await import('node:zlib');
  const { pipeline: pipe } = await import('node:stream/promises');
  const { Writable } = await import('node:stream');
  await pipe(createReadStream(gzipPath), createGunzip(), new Writable({ write(_c, _e, done) { done(); } }));
}

export async function atomicRenameDir(from, to) {
  await rename(from, to);
}
