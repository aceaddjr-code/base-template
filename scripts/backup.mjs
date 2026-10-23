#!/usr/bin/env node
// Windows / Linux 共用执行器。需要 Node 20.12+ 和 mysqldump；密码不进入命令行。
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, link } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(resolve(root, 'backend/.env')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 backend/.env'); }
const database = process.env.DB_DATABASE || 'app_starter';
const keepDays = process.env.KEEP_DAYS ?? '30';
if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('数据库名只能包含字母、数字和下划线');
if (!/^\d+$/.test(keepDays)) throw new Error('KEEP_DAYS 必须为非负整数');
const directory = resolve(process.env.BACKUP_DIR || resolve(root, 'backups'));
await mkdir(directory, { recursive: true });
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const filename = `${database}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.sql.gz`;
const temporary = resolve(directory, `.backup-${process.pid}-${Date.now()}.tmp`);
const destination = resolve(directory, filename);
const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', [
  `--host=${process.env.DB_HOST || 'localhost'}`, `--port=${process.env.DB_PORT || '3306'}`,
  `--user=${process.env.DB_USERNAME || 'root'}`, '--single-transaction', '--routines', '--triggers', database,
], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, timeout: Math.max(1, Number(process.env.BACKUP_TIMEOUT_MS || 120000) - 1000), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let stopping = false;
const interrupted = () => { stopping = true; dump.kill(); };
process.on('SIGTERM', interrupted);
process.on('SIGINT', interrupted);
const streamed = pipeline(dump.stdout, createGzip(), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
try {
  const ended = new Promise((resolveExit, reject) => {
    dump.once('error', () => reject(new Error('无法启动 mysqldump，请检查 MYSQLDUMP_BIN 和执行权限')));
    dump.once('close', code => code === 0 ? resolveExit() : reject(new Error('mysqldump 执行失败，请检查数据库连接及备份权限')));
  });
  await Promise.all([
    ended,
    streamed,
  ]);
  await pipeline(createReadStream(temporary), createGunzip(), new Writable({ write(_chunk, _encoding, done) { done(); } }));
  if (stopping) throw new Error('备份已中止，未发布文件');
  // 不覆盖已有同名备份；文件校验完成后才让列表可见。
  await link(temporary, destination);
  await unlink(temporary);
  const cutoff = Date.now() - Number(keepDays) * 86400000;
  for (const name of await readdir(directory)) {
    if (name === filename || !name.startsWith(`${database}-`) || !/^[A-Za-z0-9_-]+-\d{8}-\d{6}\.sql\.gz$/.test(name)) continue;
    const path = resolve(directory, name);
    const info = await stat(path);
    if (info.isFile() && info.mtimeMs < cutoff) await unlink(path);
  }
  process.stdout.write(JSON.stringify({ filename }) + '\n');
} catch (error) {
  dump.kill();
  await Promise.allSettled([streamed]);
  await unlink(temporary).catch(() => {});
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  process.off('SIGTERM', interrupted);
  process.off('SIGINT', interrupted);
}
