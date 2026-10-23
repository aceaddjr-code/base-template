import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { basename, extname, resolve } from 'path';

/** 备份文件名白名单（防路径穿越/防注入——备份文件含全库数据） */
const BACKUP_FILE_RE = /^[A-Za-z0-9_-]+-\d{8}-\d{6}\.sql\.gz$/;

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

  /** 备份文件列表（按时间降序；只列白名单命中的备份产物） */
  async listBackups(): Promise<Array<{ filename: string; size: number; date: string }>> {
    const dir = this.backupDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.logger.error('无法读取备份目录，请检查目录权限');
      throw new BadRequestException('无法读取备份目录，请联系管理员检查权限');
    }
    const rows: Array<{ filename: string; size: number; mtime: number; date: string }> = [];
    for (const f of files) {
      if (!BACKUP_FILE_RE.test(f)) continue;
      try {
        const st = await stat(resolve(dir, f));
        if (!st.isFile()) continue;
        rows.push({
          filename: f,
          size: st.size,
          mtime: st.mtimeMs,
          date: formatDateTime(st.mtime),
        });
      } catch { /* 文件被并发清理，跳过 */ }
    }
    return rows.sort((a, b) => b.mtime - a.mtime).map(({ filename, size, date }) => ({ filename, size, date }));
  }

  /** 子进程异步执行；保持原返回契约，不阻塞 Node 事件循环。 */
  async runBackup(): Promise<{ filename: string; size: number; date: string }> {
    if (this.running) throw new ConflictException('备份正在执行，请等待当前备份完成');
    this.running = true;
    this.state = { status: 'running', startedAt: new Date().toISOString() };
    const script = this.backupScript();
    try {
      const previous = new Set((await this.listBackups()).map(item => item.filename));
      const executable = this.config.get<string>('BACKUP_EXECUTABLE') || (extname(script) === '.sh' ? 'bash' : process.execPath);
      await new Promise<void>((done, fail) => {
        execFile(executable, [script], {
          timeout: Number(this.config.get('BACKUP_TIMEOUT_MS') ?? 120000), maxBuffer: 64 * 1024,
          windowsHide: true, env: { ...process.env, BACKUP_DIR: this.backupDir() },
        }, error => error ? fail(error) : done());
      });
      const result = (await this.listBackups()).find(item => !previous.has(item.filename));
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
