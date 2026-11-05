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
  it('列表区分完整集合与仅数据库类型（磁盘 manifest 为状态事实来源）', async () => {
    await writeFile(join(directory, 'test-20261020-120000.sql.gz'), 'legacy');
    const setId = 'test-full-20261105-010203-ab12cd34';
    await mkdir(join(directory, setId));
    await writeFile(join(directory, setId, 'manifest.json'), JSON.stringify({
      formatVersion: 1, backupId: setId, state: 'complete',
      createdAt: '2026-11-05T01:02:03.000Z', finishedAt: '2026-11-05T01:02:04.000Z',
      database: { bytes: 42 },
    }));
    await mkdir(join(directory, '.staging-test-full-20261105-020304-ef56ab78'));
    const service = await fixture('process.exit(0)');
    const list = await service.listBackups();
    expect(list).toHaveLength(3);
    // 同夹具 mtime 均为当前，complete 的 finishedAt 为过去 → 两条 full-set 与一条 database-only 均在场即可
    expect(list.find(item => item.state === 'creating')).toMatchObject({ type: 'full-set', backupId: 'test-full-20261105-020304-ef56ab78' });
    expect(list.find(item => item.state === 'complete')).toMatchObject({ type: 'full-set', backupId: setId });
    expect(list.find(item => item.type === 'database-only')).toMatchObject({ filename: 'test-20261020-120000.sql.gz' });
  });

  it('共享锁持有期间拒绝发起 SQL 备份（尊重完整备份/恢复窗口）', async () => {
    const service = await fixture(`setTimeout(() => { require('fs').writeFileSync(require('path').join(process.env.BACKUP_DIR, 'test-20261105-030000.sql.gz'), 'x'); }, 10);`);
    await writeFile(join(directory, '.backup-lock'), JSON.stringify({ host: 'h', pid: 1 }));
    // mtime 为“现在”，锁新鲜
    await expect(service.runBackup()).rejects.toThrow('共享锁');
    const list = await service.listBackups();
    expect(list.filter(item => item.type === 'database-only')).toHaveLength(0);
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
