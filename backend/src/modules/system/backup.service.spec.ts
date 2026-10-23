import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BackupService } from './backup.service';

describe('备份异步执行和状态（真实子进程，非真实数据库备份）', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'base-backup-test-')); });
  afterEach(async () => { if (dirname(directory) !== tmpdir()) throw new Error('拒绝清理非测试目录'); await rm(directory, { recursive: true, force: true }); });
  async function fixture(code: string, timeout = 5000) {
    const script = join(directory, 'executor.cjs');
    await writeFile(script, code);
    return new BackupService(new ConfigService({ BACKUP_DIR: directory, BACKUP_SCRIPT: script, BACKUP_TIMEOUT_MS: timeout, BACKUP_EXECUTABLE: process.execPath }));
  }
  it('执行期间计时器继续运行，拒绝重复触发，完成后可下载本次新文件', async () => {
    const service = await fixture(`setTimeout(() => { require('fs').writeFileSync(require('path').join(process.env.BACKUP_DIR, 'test-20261021-120000.sql.gz'), 'fixture'); }, 200);`);
    const pending = service.runBackup();
    await new Promise(done => setTimeout(done, 30));
    expect(service.status().status).toBe('running');
    await expect(service.runBackup()).rejects.toThrow('备份正在执行');
    const result = await pending;
    expect(result.filename).toBe('test-20261021-120000.sql.gz');
    expect(service.status()).toMatchObject({ status: 'succeeded', result });
    expect((await service.getBackupFile(result.filename)).size).toBe(7);
  });
  it('脚本没有产出新文件时不能拿历史文件冒充成功', async () => {
    await writeFile(join(directory, 'test-20261020-120000.sql.gz'), 'old');
    const service = await fixture('process.exit(0)');
    await expect(service.runBackup()).rejects.toThrow('未生成新文件');
    expect(service.status().status).toBe('failed');
  });
  it('失败不泄露子进程输出，超时会释放运行锁', async () => {
    const failing = await fixture(`process.stderr.write('password=do-not-leak'); process.exit(1);`);
    await expect(failing.runBackup()).rejects.not.toThrow('do-not-leak');
    expect(JSON.stringify(failing.status())).not.toContain('do-not-leak');
    const timeout = await fixture('setInterval(() => {}, 1000)', 50);
    await expect(timeout.runBackup()).rejects.toThrow('超时');
    expect(timeout.status().status).toBe('failed');
    await expect(timeout.runBackup()).rejects.toThrow('超时');
  });
  it('列表忽略同名目录，非法下载名被拒绝', async () => {
    const service = await fixture('');
    await mkdir(join(directory, 'test-20261020-120000.sql.gz'));
    expect(await service.listBackups()).toEqual([]);
    await expect(service.getBackupFile('wrong.txt')).rejects.toThrow('不存在');
    await expect(service.getBackupFile('test-20261020-120000.sql.gz')).rejects.toThrow('不存在');
  });
});
