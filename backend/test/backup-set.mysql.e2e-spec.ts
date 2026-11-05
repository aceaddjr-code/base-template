import { createConnection } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile, readFile, utimes, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
// jest e2e 的 cwd 是 backend/，仓库根为其上一级（与 management-permissions e2e 同口径）
const repoRoot = resolve(process.cwd(), '..');

/**
 * 完整备份集合工具（第三批 02）：真实脚本＋隔离库＋夹具目录。
 * 覆盖：停写确认强制、happy path 全集校验、目录嵌套/重解析点拒绝、
 * 共享锁忙/陈旧接管、转储失败不破坏上一份有效集合、有界清理边界。
 */
const suite = process.env.TEST_BR3_DATABASE ? describe : describe.skip;
suite('完整备份集合工具：隔离 MySQL＋夹具', () => {
  const database = process.env.TEST_BR3_DATABASE!;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let fixtureRoot: string;
  let created = false;
  const now = () => new Date();
  const dirs = () => ({
    backups: join(fixtureRoot, 'backups'),
    private: join(fixtureRoot, 'private'),
    public: join(fixtureRoot, 'public'),
  });

  const runTool = (args: string[], overrides: Record<string, string> = {}) =>
    execFileAsync(process.execPath, [join(repoRoot, 'scripts', 'backup-set.mjs'), ...args], {
      cwd: repoRoot,
      timeout: 90_000,
      env: {
        ...process.env,
        DB_DATABASE: database,
        BACKUP_DIR: dirs().backups,
        ATTACHMENT_PRIVATE_DIR: dirs().private,
        UPLOAD_DIR: dirs().public,
        BACKUP_TIMEOUT_MS: '60000',
        MYSQLDUMP_BIN: process.env.MYSQLDUMP_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
        ...overrides,
      },
    });

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    await admin.query(`CREATE TABLE \`${database}\`.items (id INT PRIMARY KEY, title VARCHAR(50))`);
    await admin.query(`CREATE TABLE \`${database}\`.schema_migrations (name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64), applied_at TIMESTAMP)`);
    await admin.query(`INSERT INTO \`${database}\`.schema_migrations (name, checksum) VALUES ('patch-a', 'x')`);
    await admin.query(`INSERT INTO \`${database}\`.items (id, title) VALUES (1, '虚构单据甲')`);

    fixtureRoot = await mkdtemp(join(tmpdir(), 'br3-backup-'));
    const d = dirs();
    await mkdir(join(d.private, '2026/11'), { recursive: true });
    await mkdir(join(d.private, '2026/10'), { recursive: true });
    await mkdir(join(d.public, '2026/11'), { recursive: true });
    await writeFile(join(d.private, '2026/11/a.png'), 'file-library-a');
    await writeFile(join(d.private, '2026/11/b.pdf'), 'business-bound-b');
    await writeFile(join(d.private, '2026/10/c.txt'), 'recycle-held-c');
    await writeFile(join(d.public, '2026/11/avatar.png'), 'public-avatar');
  }, 120000);

  afterAll(async () => {
    if (fixtureRoot && fixtureRoot.startsWith(tmpdir())) await rm(fixtureRoot, { recursive: true, force: true });
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  it('未携带 --confirm-quiesced 拒绝执行（停写协议区别于页面操作）', async () => {
    await expect(runTool(['backup'])).rejects.toThrow(/停写/);
  });

  it('happy path：完整集合原子发布，manifest 校验和逐项可复验，list 双类型输出', async () => {
    const { stdout } = await runTool(['backup', '--confirm-quiesced']);
    const summary = JSON.parse(stdout.trim().split('\n').at(-1)!);
    const d = dirs();
    const setDir = join(d.backups, summary.backupId);
    const manifest = JSON.parse(await readFile(join(setDir, 'manifest.json'), 'utf8'));
    expect(manifest.state).toBe('complete');
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.migrations).toEqual(['patch-a']);
    expect(manifest.envNames).toContain('JWT_SECRET');
    expect(JSON.stringify(manifest)).not.toContain(String(process.env.DB_PASSWORD ?? ''));
    // 附件四类中的三类＋公开根各就位（YYYY/MM 相对路径保留）
    const paths = manifest.files.map((f: any) => f.path);
    expect(paths).toContain('attachments/2026/11/a.png');
    expect(paths).toContain('attachments/2026/10/c.txt');
    expect(paths).toContain('public-uploads/2026/11/avatar.png');
    // 抽样校验和与磁盘一致
    const sample = manifest.files.find((f: any) => f.path === 'attachments/2026/11/a.png');
    const content = await readFile(join(setDir, 'attachments/2026/11/a.png'));
    expect(createHash('sha256').update(content).digest('hex')).toBe(sample.sha256);
    // staging 已消失（原子发布）
    expect((await readdir(d.backups)).filter(name => name.startsWith('.staging-'))).toHaveLength(0);
    // list 输出双类型（补一个旧 sql.gz 文件）
    await writeFile(join(d.backups, `${database}-20261105-010203.sql.gz`), 'legacy');
    const listed = JSON.parse((await runTool(['list'])).stdout);
    expect(listed.some((e: any) => e.type === 'full-set' && e.backupId === summary.backupId && e.state === 'complete')).toBe(true);
    expect(listed.some((e: any) => e.type === 'database-only' && e.filename.endsWith('010203.sql.gz'))).toBe(true);
  }, 120000);

  it('备份目录与附件源目录嵌套（任一方向）拒绝执行', async () => {
    const nested = join(dirs().private, 'nested-backups');
    await mkdir(nested, { recursive: true });
    await expect(runTool(['backup', '--confirm-quiesced'], { BACKUP_DIR: nested })).rejects.toThrow(/内部|嵌套/);
    await rm(nested, { recursive: true, force: true });
  }, 120000);

  it('源树内符号链接/重解析点拒绝（不静默跳过）', async () => {
    const junction = join(dirs().private, '2026/11', 'link-dir');
    try {
      await symlink(join(dirs().private, '2026/10'), junction, 'junction');
    } catch {
      return; // 平台不允许创建 junction 时跳过该用例（Windows 开发模式可建）
    }
    try {
      await expect(runTool(['backup', '--confirm-quiesced'])).rejects.toThrow(/符号链接|重解析点/);
    } finally {
      await rm(junction, { force: true }).catch(() => {});
    }
  }, 120000);

  it('共享锁忙时拒绝；陈旧锁（心跳超时）可接管', async () => {
    const lockPath = join(dirs().backups, '.backup-lock');
    await writeFile(lockPath, JSON.stringify({ host: 'tester', pid: 1, startedAt: now().toISOString() }));
    await utimes(lockPath, now(), now()); // 新鲜心跳
    await expect(runTool(['backup', '--confirm-quiesced'])).rejects.toThrow(/另一执行器|持有/);
    // 心跳超时 → 陈旧接管成功，锁被重写
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockPath, stale, stale);
    const { stdout } = await runTool(['backup', '--confirm-quiesced']);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!).backupId).toBeTruthy();
    // 执行完释放锁
    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
  }, 120000);

  it('转储失败：exit 非零、写失败记录、staging 清理、上一份有效集合仍可读', async () => {
    const before = JSON.parse((await runTool(['list'])).stdout).filter((e: any) => e.type === 'full-set' && e.state === 'complete');
    await expect(runTool(['backup', '--confirm-quiesced'], { MYSQLDUMP_BIN: 'definitely-not-a-mysqldump' })).rejects.toThrow(/mysqldump/);
    const d = dirs();
    const names = await readdir(d.backups);
    expect(names.some(name => name.startsWith('.failed-') && name.endsWith('.json'))).toBe(true);
    expect(names.filter(name => name.startsWith('.staging-'))).toHaveLength(0);
    const after = JSON.parse((await runTool(['list'])).stdout).filter((e: any) => e.type === 'full-set' && e.state === 'complete');
    expect(after.map((e: any) => e.backupId).sort()).toEqual(before.map((e: any) => e.backupId).sort());
  }, 120000);

  it('清理边界：dry-run 只列过期集合，保留最近 1 份 complete；未 --yes 不执行', async () => {
    const d = dirs();
    const listed = JSON.parse((await runTool(['list'])).stdout).filter((e: any) => e.type === 'full-set' && e.state === 'complete');
    const oldestDir = join(d.backups, listed.at(-1).backupId);
    const manifestPath = join(oldestDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.finishedAt = new Date(Date.now() - 40 * 86400000).toISOString();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    // dry-run：列出该过期集合
    const dry = JSON.parse((await runTool(['clean', '--dry-run'])).stdout);
    expect(dry.actions.some((a: any) => a.action === 'remove-set' && a.target === listed.at(-1).backupId)).toBe(true);
    // 无 --yes/--dry-run 拒绝
    await expect(runTool(['clean'])).rejects.toThrow(/--yes/);
    // 执行后：过期集合删除，最新 complete 保留（清理永不删唯一有效副本）
    const done = JSON.parse((await runTool(['clean', '--yes'])).stdout);
    expect(done.dryRun).toBe(false);
    const remaining = JSON.parse((await runTool(['list'])).stdout).filter((e: any) => e.type === 'full-set' && e.state === 'complete');
    expect(remaining.some((e: any) => e.backupId === listed.at(-1).backupId)).toBe(false);
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    expect(remaining.some((e: any) => e.backupId === listed[0].backupId)).toBe(true);
  }, 120000);
});
