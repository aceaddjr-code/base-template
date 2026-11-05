import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { basename, extname, resolve } from 'path';

/** 备份文件名白名单（防路径穿越/防注入——备份文件含全库数据） */
const BACKUP_FILE_RE = /^[A-Za-z0-9_-]+-\d{8}-\d{6}\.sql\.gz$/;
/**
 * 第三批完整集合：目录内 manifest.json 为事实来源。
 * 常量与 scripts/lib/backup-lib.mjs 共享——唯一事实来源为 backup-format.constants.json（仓库根）。
 * 修改任何值时三处同步：backup-lib.mjs / 本文件 / backup-format.constants.json。
 */
const MANIFEST_NAME = 'manifest.json';
const LOCK_NAME = '.backup-lock';
const LOCK_STALE_MS = 60_000;
export const BACKUP_FORMAT_CONSTANTS = { MANIFEST_NAME, LOCK_NAME, LOCK_STALE_MS };

/** database-only=旧 SQL 转储；full-set=完整集合（数据库＋附件＋manifest，磁盘 manifest 为状态事实） */
export type BackupEntry =
  | { type: 'database-only'; filename: string; size: number; date: string }
  | { type: 'full-set'; filename: string; backupId: string; state: 'creating' | 'complete' | 'failed' | 'corrupt'; date: string; size?: number; error?: string | null };

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;
  private state: { status: 'idle' | 'running' | 'succeeded' | 'failed'; startedAt?: string; finishedAt?: string; result?: { filename: string; size: number; date: string }; message?: string } = { status: 'idle' };

  constructor(private readonly config: ConfigService) {}

  status() { return { ...this.state }; }

  private backupDir(): string {
    // 默认项目根/backups（后端 cwd=backend，向上取项目根——与 scripts/backup.sh 的目录约定一致）
    // 部署时配置绝对路径，避免工作目录变化影响备份位置。
    return resolve(process.cwd(), this.config.get<string>('BACKUP_DIR') ?? '../backups');
  }

  private backupScript(): string {
    return resolve(process.cwd(), this.config.get<string>('BACKUP_SCRIPT') ?? '../scripts/backup.mjs');
  }

  /** 备份条目列表（完整集合以磁盘 manifest 为准；旧 sql.gz 按白名单；按时间降序） */
  async listBackups(): Promise<BackupEntry[]> {
    const dir = this.backupDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.logger.error('无法读取备份目录，请检查目录权限');
      throw new BadRequestException('无法读取备份目录，请联系管理员检查权限');
    }
    const rows: Array<{ entry: BackupEntry; sortAt: number }> = [];
    for (const f of files) {
      const path = resolve(dir, f);
      try {
        const st = await stat(path);
        if (st.isDirectory()) {
          // 完整集合目录：manifest 即状态；staging（.staging- 前缀）呈现 creating
          const isStaging = f.startsWith('.staging-');
          const manifestPath = resolve(dir, f, MANIFEST_NAME);
          const manifestStat = isStaging ? null : await stat(manifestPath).catch(() => null);
          if (!isStaging && !manifestStat) continue;
          let manifest: any = null;
          if (manifestStat) {
            try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* 损坏集合按 corrupt 呈现 */ }
          }
          const entry: BackupEntry = {
            type: 'full-set',
            backupId: manifest?.backupId ?? (isStaging ? f.slice('.staging-'.length) : f),
            filename: manifest?.backupId ?? (isStaging ? f.slice('.staging-'.length) : f),
            state: manifest?.state ?? (isStaging ? 'creating' : 'corrupt'),
            date: manifest?.finishedAt ?? manifest?.createdAt ?? st.mtime.toISOString(),
            size: manifest?.database?.bytes ?? 0,
            error: manifest?.error ?? null,
          };
          rows.push({ entry, sortAt: new Date(entry.date).getTime() || st.mtimeMs });
          continue;
        }
        if (!st.isFile() || !BACKUP_FILE_RE.test(f) || f.startsWith('.')) continue;
        rows.push({
          entry: { type: 'database-only', filename: f, size: st.size, date: formatDateTime(st.mtime) },
          sortAt: st.mtimeMs,
        });
      } catch { /* 文件被并发清理，跳过 */ }
    }
    return rows.sort((a, b) => b.sortAt - a.sortAt).map(row => row.entry);
  }

  /** 子进程异步执行；保持原返回契约，不阻塞 Node 事件循环。 */
  async runBackup(): Promise<{ filename: string; size: number; date: string }> {
    if (this.running) throw new ConflictException('备份正在执行，请等待当前备份完成');
    await this.assertSharedLockFree();
    this.running = true;
    this.state = { status: 'running', startedAt: new Date().toISOString() };
    const script = this.backupScript();
    try {
      // 仅以旧类型（sql.gz）作“新文件”判定；完整集合由 backup-set 工具负责
      const previous = new Set((await this.listBackups()).filter(item => item.type === 'database-only').map(item => item.filename));
      const executable = this.config.get<string>('BACKUP_EXECUTABLE') || (extname(script) === '.sh' ? 'bash' : process.execPath);
      await new Promise<void>((done, fail) => {
        execFile(executable, [script], {
          timeout: Number(this.config.get('BACKUP_TIMEOUT_MS') ?? 120000), maxBuffer: 64 * 1024,
          windowsHide: true, env: { ...process.env, BACKUP_DIR: this.backupDir() },
        }, error => error ? fail(error) : done());
      });
      const result = (await this.listBackups()).find((item): item is Extract<BackupEntry, { type: 'database-only' }> =>
        item.type === 'database-only' && !previous.has(item.filename));
      if (!result) throw new Error('NO_NEW_BACKUP');
      this.state = { ...this.state, status: 'succeeded', finishedAt: new Date().toISOString(), result };
      return result;
    } catch (e) {
      // 子进程错误含命令/环境/数据库输出，不能直接返回或写入业务日志。
      const timedOut = (e as { killed?: boolean }).killed;
      const msg = timedOut ? '备份超时，请检查执行状态和备份目录' : '备份失败或未生成新文件，请检查执行器、数据库权限和备份目录';
      this.state = { ...this.state, status: 'failed', finishedAt: new Date().toISOString(), message: msg };
      this.logger.error(msg);
      throw new BadRequestException(msg);
    } finally {
      this.running = false;
    }
  }

  /** 共享锁尊重（set-format §4）：完整备份/恢复持有锁期间，页面 SQL 备份拒绝并发写同一目录。 */
  private async assertSharedLockFree(): Promise<void> {
    const lockPath = resolve(this.backupDir(), LOCK_NAME);
    try {
      const info = await stat(lockPath);
      if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) {
        throw new ConflictException('完整备份或恢复正在执行（共享锁持有中），请等待完成后再发起 SQL 备份');
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** 下载：文件名白名单 + basename 防穿越 */
  async getBackupFile(filename: string): Promise<{ path: string; size: number }> {
    const name = basename(filename); // 剥离任何目录成分
    if (!BACKUP_FILE_RE.test(name)) {
      throw new NotFoundException('备份文件不存在');
    }
    const path = resolve(this.backupDir(), name);
    try {
      const st = await stat(path);
      if (!st.isFile()) throw new NotFoundException('备份文件不存在');
      return { path, size: st.size };
    } catch {
      throw new NotFoundException('备份文件不存在');
    }
  }

  /** 下载流（调用方返回 StreamableFile） */
  stream(path: string) {
    return createReadStream(path);
  }
}

/** 本地时间格式 YYYY-MM-DD HH:mm:ss（UTC 坑：勿用 toISOString） */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
