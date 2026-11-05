import { createConnection } from 'mysql2/promise';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), '..');
const MYSQL_BIN = process.env.MYSQL_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe';
const MYSQLDUMP_BIN = process.env.MYSQLDUMP_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe';

/**
 * 隔离恢复工具（第三批 03）：真实脚本＋隔离库。
 * 覆盖：六类预检在触碰目标前拒绝、happy path 数据/文件恢复、
 * “备份后源库变更”时间点证明、失败清理、输出不含口令。
 */
const suite = process.env.TEST_BR3_RESTORE_DATABASE ? describe : describe.skip;
suite('隔离恢复工具：真实脚本＋隔离库', () => {
  const sourceDatabase = process.env.TEST_BR3_RESTORE_DATABASE!;
  const targetDatabase = `${sourceDatabase}9`;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let fixtureRoot: string;
  let sourceCreated = false;
  let backupId = '';
  const dirs = () => ({
    backups: join(fixtureRoot, 'backups'),
    private: join(fixtureRoot, 'private'),
    public: join(fixtureRoot, 'public'),
    restoreAttachments: join(fixtureRoot, 'restore-private'),
    restorePublic: join(fixtureRoot, 'restore-public'),
  });

  const runBackup = (overrides: Record<string, string> = {}) =>
    execFileAsync(process.execPath, [join(repoRoot, 'scripts', 'backup-set.mjs'), 'backup', '--confirm-quiesced'], {
      cwd: repoRoot, timeout: 90_000,
      env: { ...process.env, DB_DATABASE: sourceDatabase, BACKUP_DIR: dirs().backups, ATTACHMENT_PRIVATE_DIR: dirs().private, UPLOAD_DIR: dirs().public, MYSQLDUMP_BIN, BACKUP_TIMEOUT_MS: '60000', ...overrides },
    });

  const runRestore = (args: string[], overrides: Record<string, string> = {}) =>
    execFileAsync(process.execPath, [join(repoRoot, 'scripts', 'restore-set.mjs'), ...args], {
      cwd: repoRoot, timeout: 90_000,
      env: { ...process.env, BACKUP_DIR: dirs().backups, ATTACHMENT_PRIVATE_DIR: dirs().private, UPLOAD_DIR: dirs().public, MYSQL_BIN, ...overrides },
    });

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(sourceDatabase) || sourceDatabase === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    // 前缀清障：历史失败运行可能留下 source 前缀的隔离目标（如 …091/…092），一并清理
    const [stale] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${sourceDatabase}%`]);
    for (const row of stale as any[]) {
      if (row.name === sourceDatabase) throw new Error(`源隔离库 ${sourceDatabase} 已存在（非本套件残留命名），请人工确认后重试`);
      await admin.query(`DROP DATABASE \`${row.name}\``);
    }
    await admin.query(`CREATE DATABASE \`${sourceDatabase}\` CHARACTER SET utf8mb4`); sourceCreated = true;
    for (const [table, definition] of [
      ['users', '(id INT PRIMARY KEY, username VARCHAR(50), display_name VARCHAR(50) NULL)'],
      ['example_items', '(id INT PRIMARY KEY, title VARCHAR(100), owner_id INT NULL)'],
      ['attachments', '(id INT PRIMARY KEY, storage_path VARCHAR(255), original_name VARCHAR(255))'],
      ['system_logs', '(id INT PRIMARY KEY, action VARCHAR(20))'],
      ['schema_migrations', '(name VARCHAR(255) PRIMARY KEY, checksum VARCHAR(64), applied_at TIMESTAMP)'],
    ] as Array<[string, string]>) {
      await admin.query(`CREATE TABLE \`${sourceDatabase}\`.${table} ${definition}`);
    }
    // 迁移账本对齐当前代码补丁清单（恢复端兼容检查依据）
    const patchNames = (await readdir(join(repoRoot, 'docs/sql'))).filter(name => name.endsWith('.sql')).sort();
    for (const name of patchNames) await admin.query(`INSERT INTO \`${sourceDatabase}\`.schema_migrations (name, checksum) VALUES (?, 'x')`, [name]);
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.users (id, username, display_name) VALUES (1, 'restore-user', '恢复用户')`);
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.example_items (id, title, owner_id) VALUES (1, '备份前单据甲', 1), (2, '备份前单据乙', 1)`);
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.attachments (id, storage_path, original_name) VALUES (1, '2026/11/b.pdf', 'b.pdf')`);
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.system_logs (id, action) VALUES (1, 'create')`);

    fixtureRoot = await mkdtemp(join(tmpdir(), 'br3-restore-'));
    await mkdir(join(dirs().private, '2026/11'), { recursive: true });
    await mkdir(join(dirs().public, '2026/11'), { recursive: true });
    await writeFile(join(dirs().private, '2026/11/b.pdf'), 'business-bound-b');
    await writeFile(join(dirs().public, '2026/11/avatar.png'), 'public-avatar');
  }, 120000);

  afterAll(async () => {
    if (fixtureRoot && fixtureRoot.startsWith(tmpdir())) await rm(fixtureRoot, { recursive: true, force: true });
    const [created] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${sourceDatabase}%`]);
    for (const row of created as any[]) {
      await admin.query(`DROP DATABASE \`${row.name}\``).catch(() => {});
    }
    await admin?.end();
  });

  const restoreArgs = () => [
    '--backup', backupId, '--database', targetDatabase,
    '--attachments-dir', dirs().restoreAttachments, '--public-dir', dirs().restorePublic,
  ];

  it('happy path：恢复到新库与空目录；“备份后源变更”不出现（时间点证明）', async () => {
    const { stdout } = await runBackup();
    backupId = JSON.parse(stdout.trim().split('\n').at(-1)!).backupId;

    // 备份后源库/源目录继续变化（证明恢复停在集合时间点）
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.example_items (id, title, owner_id) VALUES (3, '备份后新增单据', 1)`);
    await writeFile(join(dirs().private, '2026/11', 'post-backup.txt'), 'created-after-backup');

    const restored = await runRestore(restoreArgs());
    const report = JSON.parse(restored.stdout.trim().split('\n')[0]);
    expect(report.database).toBe(targetDatabase);
    expect(report.rowCounts.example_items).toBe(2); // 备份后新增的第 3 条不在
    expect(report.rowCounts.users).toBe(1);
    expect(report.restoredFiles).toBeGreaterThan(1);
    expect(restored.stdout).toContain('JWT_SECRET');
    // 数据侧抽样
    const [rows] = await admin.query(`SELECT title FROM \`${targetDatabase}\`.example_items ORDER BY id`);
    expect((rows as any[]).map(r => r.title)).toEqual(['备份前单据甲', '备份前单据乙']);
    const [migrations] = await admin.query(`SELECT COUNT(*) AS n FROM \`${targetDatabase}\`.schema_migrations`);
    expect(Number((migrations as any[])[0].n)).toBe((await readdir(join(repoRoot, 'docs/sql'))).filter(n => n.endsWith('.sql')).length);
    // 文件侧：原文件在、备份后新增不在；attachments.storage_path 指向的文件存在
    const restoredFiles = await readdir(join(dirs().restoreAttachments, '2026/11'));
    expect(restoredFiles).toContain('b.pdf');
    expect(restoredFiles).not.toContain('post-backup.txt');
    const content = await readFile(join(dirs().restoreAttachments, '2026/11/b.pdf'), 'utf8');
    expect(createHash('sha256').update(content).digest('hex')).toBe(createHash('sha256').update('business-bound-b').digest('hex'));
    // 源库的第 3 条仍在（恢复是只读复制）
    const [sourceRows] = await admin.query(`SELECT COUNT(*) AS n FROM \`${sourceDatabase}\`.example_items`);
    expect(Number((sourceRows as any[])[0].n)).toBe(3);
    expect(restored.stdout).not.toContain(String(process.env.DB_PASSWORD ?? ''));
  }, 120000);

  it('目标库已存在拒绝；非隔离命名拒绝；等于当前 DB_DATABASE 拒绝', async () => {
    // 上一用例已建 targetDatabase 且已填目录：换新目录命中“库已存在”，原目录命中“非空”
    await expect(runRestore(['--backup', backupId, '--database', targetDatabase, '--attachments-dir', join(fixtureRoot, 'x3'), '--public-dir', join(fixtureRoot, 'x4')])).rejects.toThrow(/已存在/);
    await expect(runRestore(restoreArgs())).rejects.toThrow(/非空/);
    await expect(runRestore([...restoreArgs().slice(0, 2), '--database', 'app_starter', '--attachments-dir', join(fixtureRoot, 'x1'), '--public-dir', join(fixtureRoot, 'x2')]))
      .rejects.toThrow(/隔离库命名/);
    await expect(runRestore([...restoreArgs().slice(0, 2), '--database', sourceDatabase, '--attachments-dir', join(fixtureRoot, 'x1'), '--public-dir', join(fixtureRoot, 'x2')], { DB_DATABASE: sourceDatabase }))
      .rejects.toThrow(/DB_DATABASE/);
  }, 120000);

  it('预检拒绝发生在触碰目标之前：损坏校验和/缺文件/非 complete/非空目录', async () => {
    const tamperedRoot = join(fixtureRoot, 'backups-tampered');
    await mkdir(tamperedRoot, { recursive: true });
    await cp(join(dirs().backups, backupId), join(tamperedRoot, backupId), { recursive: true });
    const restoreTampered = (extra: string[] = [], overrides: Record<string, string> = {}) =>
      runRestore(['--backup', backupId, '--database', `${targetDatabase}1`, '--attachments-dir', join(fixtureRoot, 't1'), '--public-dir', join(fixtureRoot, 't2'), ...extra], { BACKUP_DIR: tamperedRoot, ...overrides });

    // 校验和损坏：改动一个附件字节
    await writeFile(join(tamperedRoot, backupId, 'attachments/2026/11/b.pdf'), 'tampered!!');
    await expect(restoreTampered()).rejects.toThrow(/大小不符|校验和不符/);
    await expect(statDatabase(`${targetDatabase}1`)).resolves.toBe(false);
    // 缺文件
    await rm(join(tamperedRoot, backupId, 'attachments/2026/11/b.pdf'));
    await expect(restoreTampered()).rejects.toThrow(/缺文件/);
    // 非 complete 集合（改 manifest state）
    await cp(join(dirs().backups, backupId), join(tamperedRoot, backupId), { recursive: true });
    const manifestPath = join(tamperedRoot, backupId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.state = 'creating';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(restoreTampered()).rejects.toThrow(/只有 complete/);
    // 非空目录
    manifest.state = 'complete';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await mkdir(join(fixtureRoot, 't1'), { recursive: true });
    await writeFile(join(fixtureRoot, 't1', 'occupied.txt'), 'x');
    await expect(restoreTampered()).rejects.toThrow(/非空/);
    // 各拒绝均未创建目标库
    await expect(statDatabase(`${targetDatabase}1`)).resolves.toBe(false);
    await rm(tamperedRoot, { recursive: true, force: true });
  }, 120000);

  it('迁移版本不一致需显式确认；执行失败清理本次创建的隔离资源', async () => {
    // 造一个账本多一条假补丁的源备份
    await admin.query(`INSERT INTO \`${sourceDatabase}\`.schema_migrations (name, checksum) VALUES ('9999-fake.sql', 'x')`);
    const { stdout } = await runBackup();
    const mismatchId = JSON.parse(stdout.trim().split('\n').at(-1)!).backupId;
    await admin.query(`DELETE FROM \`${sourceDatabase}\`.schema_migrations WHERE name = '9999-fake.sql'`);

    const restoreMismatch = (extra: string[] = []) =>
      runRestore(['--backup', mismatchId, '--database', `${targetDatabase}2`, '--attachments-dir', join(fixtureRoot, 'm1'), '--public-dir', join(fixtureRoot, 'm2'), ...extra]);
    await expect(restoreMismatch()).rejects.toThrow(/迁移版本/);
    await expect(restoreMismatch(['--allow-migration-mismatch'])).resolves.toBeTruthy();
    await expect(statDatabase(`${targetDatabase}2`)).resolves.toBe(true);

    // 执行期失败（导入端无法解压）：目标被清理，不留半成品库
    const brokenRoot = join(fixtureRoot, 'backups-broken');
    await mkdir(brokenRoot, { recursive: true });
    await cp(join(dirs().backups, mismatchId), join(brokenRoot, mismatchId), { recursive: true });
    await writeFile(join(brokenRoot, mismatchId, 'database.sql.gz'), 'not-a-gzip'); // sha 已变 → 预检拦截
    await expect(runRestore(['--backup', mismatchId, '--database', `${targetDatabase}3`, '--attachments-dir', join(fixtureRoot, 'b1'), '--public-dir', join(fixtureRoot, 'b2')], { BACKUP_DIR: brokenRoot }))
      .rejects.toThrow(/大小不符|校验和不符|无法解压/);
    await expect(statDatabase(`${targetDatabase}3`)).resolves.toBe(false);
  }, 120000);

  async function statDatabase(name: string): Promise<boolean> {
    const [rows] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
    return (rows as any[]).length > 0;
  }
});
