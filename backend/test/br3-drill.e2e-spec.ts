import { createConnection } from 'mysql2/promise';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), '..');
const MYSQLDUMP_BIN = process.env.MYSQLDUMP_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe';
const MYSQL_BIN = process.env.MYSQL_BIN || 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe';

/**
 * 第三批 04 应用级演练（子进程真实起停，贴近停写窗口语义）：
 * 源应用写入单据/挂接附件/回收站 → 停应用 → 完整集合备份 → 临时异地副本
 * → 隔离恢复 → 恢复应用以轮换密钥启动 → HTTP 逐项验证。全程隔离库＋虚构账号。
 */
const suite = process.env.TEST_BR3_DRILL_DATABASE ? describe : describe.skip;
suite('完整备份→隔离恢复→应用验证演练', () => {
  const sourceDatabase = process.env.TEST_BR3_DRILL_DATABASE!;
  const restoreDatabase = `${sourceDatabase}9`;
  const adminInitial = 'drill-admin-initial-2026';
  const adminPassword = 'drill-admin-final-2026';
  const uploadedContent = 'drill-attachment-content-20261105';
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let fixtureRoot: string;
  let app: ChildProcess | null = null;
  const dirs = () => ({
    backups: join(fixtureRoot, 'backups'),
    srcPrivate: join(fixtureRoot, 'src-private'),
    srcPublic: join(fixtureRoot, 'src-public'),
    offsite: join(fixtureRoot, 'offsite'),
    restorePrivate: join(fixtureRoot, 'restore-private'),
    restorePublic: join(fixtureRoot, 'restore-public'),
  });

  const startApp = async (port: number, env: Record<string, string>) => {
    const child = spawn(process.execPath, ['dist/main.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development', DB_SYNCHRONIZE: 'true',
        PORT: String(port),
        LOGIN_IP_MAX: '500', BACKUP_TIMEOUT_MS: '90000',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', chunk => { output += String(chunk); });
    child.stderr!.on('data', chunk => { output += String(chunk); });
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const probe = await fetch(`${base}/api/v1/health/live`);
        if (probe.ok) break;
      } catch { /* 尚未监听 */ }
      if (child.exitCode !== null) throw new Error(`应用提前退出（code=${child.exitCode}）：${output.slice(-800)}`);
      await new Promise(done => setTimeout(done, 500));
    }
    return { child, base, output: () => output };
  };
  const stopApp = async (child: ChildProcess) => {
    child.kill();
    await new Promise<void>(done => {
      child.once('exit', () => done());
      setTimeout(() => { child.kill('SIGKILL'); done(); }, 8000);
    });
  };
  const api = async (base: string, path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, headers: response.headers };
  };
  const cookieOf = (headers: Headers) => (headers.getSetCookie?.() ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0];

  const runTool = (script: string, args: string[], overrides: Record<string, string> = {}) =>
    execFileAsync(process.execPath, [join(repoRoot, 'scripts', script), ...args], {
      cwd: repoRoot, timeout: 120_000,
      env: {
        ...process.env,
        DB_DATABASE: sourceDatabase,
        BACKUP_DIR: dirs().backups,
        ATTACHMENT_PRIVATE_DIR: dirs().srcPrivate,
        UPLOAD_DIR: dirs().srcPublic,
        MYSQLDUMP_BIN, MYSQL_BIN,
        ...overrides,
      },
    });

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(sourceDatabase) || sourceDatabase === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [stale] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${sourceDatabase}%`]);
    for (const row of stale as any[]) await admin.query(`DROP DATABASE \`${row.name}\``);
    fixtureRoot = await mkdtemp(join(tmpdir(), 'br3-drill-'));
    await mkdir(dirs().srcPrivate, { recursive: true });
    await mkdir(dirs().srcPublic, { recursive: true });
  }, 120000);

  afterAll(async () => {
    if (app) await stopApp(app).catch(() => {});
    if (fixtureRoot && fixtureRoot.startsWith(tmpdir())) await rm(fixtureRoot, { recursive: true, force: true });
    const [created] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${sourceDatabase}%`]);
    for (const row of created as any[]) await admin.query(`DROP DATABASE \`${row.name}\``).catch(() => {});
    await admin?.end();
  });

  it('源应用→停写→完整备份→异地副本→隔离恢复→恢复应用验证', async () => {
    // TypeORM synchronize 只建表不建库：源库先显式创建（恢复库由 restore-set 建立）
    await admin.query(`CREATE DATABASE \`${sourceDatabase}\` CHARACTER SET utf8mb4`);
    const source = await startApp(3012, {
      DB_DATABASE: sourceDatabase,
      ATTACHMENT_PRIVATE_DIR: dirs().srcPrivate, UPLOAD_DIR: dirs().srcPublic,
      ADMIN_DEFAULT_PASSWORD: adminInitial, BACKUP_DIR: dirs().backups,
    });
    app = source.child;
    try {
      const base = source.base;
      const login = await api(base, '/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginid: 'admin', password: adminInitial }),
      });
      expect(login.status).toBe(201);
      const restricted = cookieOf(login.headers)!;
      const change = await api(base, '/api/v1/auth/password', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: restricted },
        body: JSON.stringify({ oldPassword: adminInitial, newPassword: adminPassword, confirmPassword: adminPassword }),
      });
      expect(change.status).toBe(200);
      const relogin = await api(base, '/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginid: 'admin', password: adminPassword }),
      });
      const session = cookieOf(relogin.headers)!;
      const sourceToken = session;

      const create = (title: string, status: string) => api(base, '/api/v1/examples/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session },
        body: JSON.stringify({ title, status }),
      });
      const itemA = await create('演练单据甲', 'pending');
      expect(itemA.status).toBe(201);
      const itemB = await create('演练单据乙', 'doing');

      const uploadAndBind = async (itemId: number, name: string) => {
        const form = new FormData();
        form.append('file', new Blob([Buffer.from(uploadedContent)], { type: 'application/octet-stream' }), name);
        const uploaded = await api(base, '/api/v1/examples/items/attachments/upload', { method: 'POST', headers: { Cookie: session }, body: form });
        expect(uploaded.status).toBe(201);
        const bound = await api(base, `/api/v1/examples/items/${itemId}/attachments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session },
          body: JSON.stringify({ attachmentId: uploaded.body.data.id }),
        });
        expect(bound.status).toBe(201);
      };
      await uploadAndBind(itemA.body.data.id, 'drill-a.txt');
      await uploadAndBind(itemB.body.data.id, 'drill-b.txt');
      const deleted = await api(base, `/api/v1/examples/items/${itemB.body.data.id}`, { method: 'DELETE', headers: { Cookie: session } });
      expect(deleted.status).toBe(200);

      // —— 停写窗口：停止源应用进程（全部写入口与后台定时器随进程结束）——
      await stopApp(source.child);
      app = null;

      // —— 完整备份与临时异地副本 ——
      const backupRun = await runTool('backup-set.mjs', ['backup', '--confirm-quiesced']);
      const summary = JSON.parse(backupRun.stdout.trim().split('\n').at(-1)!);
      const offsiteRun = await runTool('backup-set.mjs', ['copy-offsite', '--backup', summary.backupId, '--target', dirs().offsite]);
      expect(JSON.parse(offsiteRun.stdout.trim().split('\n').at(-1)!).copied).toBe(summary.fileCount);

      // —— 隔离恢复 ——
      const restoreRun = await execFileAsync(process.execPath, [join(repoRoot, 'scripts', 'restore-set.mjs'),
        '--backup', summary.backupId, '--database', restoreDatabase,
        // 源库为 synchronize 建表（无迁移账本），与代码补丁清单必然差异：显式确认继续
        '--allow-migration-mismatch',
        '--attachments-dir', dirs().restorePrivate, '--public-dir', dirs().restorePublic], {
        cwd: repoRoot, timeout: 120_000,
        env: { ...process.env, BACKUP_DIR: dirs().backups, ATTACHMENT_PRIVATE_DIR: dirs().srcPrivate, UPLOAD_DIR: dirs().srcPublic, MYSQL_BIN },
      });
      const report = JSON.parse(restoreRun.stdout.trim().split('\n')[0]);
      expect(report.rowCounts.example_items).toBeGreaterThanOrEqual(2);
      expect(restoreRun.stdout).toContain('JWT_SECRET');

      // —— 恢复应用：隔离库＋恢复目录＋轮换密钥 ——
      const restored = await startApp(3013, {
        DB_DATABASE: restoreDatabase, DB_SYNCHRONIZE: 'false',
        ATTACHMENT_PRIVATE_DIR: dirs().restorePrivate, UPLOAD_DIR: dirs().restorePublic,
        JWT_SECRET: 'drill-rotated-secret-0123456789abcdef-20261105',
        BACKUP_DIR: dirs().backups,
        ADMIN_DEFAULT_PASSWORD: 'should-not-be-used',
      });
      app = restored.child;
      const rbase = restored.base;
      try {
        // ① 旧密钥会话对新应用无效（密钥轮换对照，非“解释模拟旧会话”）
        const staleSession = await api(rbase, '/api/v1/auth/profile', { headers: { Cookie: sourceToken } });
        expect(staleSession.status).toBe(401);
        // ② 账号与密码哈希随库恢复
        const relogin2 = await api(rbase, '/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginid: 'admin', password: adminPassword }),
        });
        expect(relogin2.status).toBe(201);
        const rsession = cookieOf(relogin2.headers)!;
        // ③ 单据恢复：甲在列、乙（已删除）不在列
        const list = await api(rbase, '/api/v1/examples/items?page=1&pageSize=50', { headers: { Cookie: rsession } });
        expect(list.body.data.list.some((item: any) => item.title === '演练单据甲')).toBe(true);
        expect(list.body.data.list.some((item: any) => item.title === '演练单据乙')).toBe(false);
        const itemId = list.body.data.list.find((item: any) => item.title === '演练单据甲').id;
        // ④ 附件恢复且可下载，内容与源一致
        const files = await api(rbase, `/api/v1/examples/items/${itemId}/attachments`, { headers: { Cookie: rsession } });
        expect(files.body.data.length).toBeGreaterThanOrEqual(1);
        const download = await fetch(`${rbase}/api/v1/examples/items/${itemId}/attachments/${files.body.data[0].id}/download`, { headers: { Cookie: rsession } });
        expect(download.status).toBe(200);
        expect(await download.text()).toBe(uploadedContent);
        // ⑤ 回收站恢复：删除的单据乙可查（两阶段保留）
        const recycle = await api(rbase, '/api/v1/recycle-bin', { headers: { Cookie: rsession } });
        expect(JSON.stringify(recycle.body)).toContain('演练单据乙');
        // ⑥ 备份页双类型列表：完整集合 complete 可见
        const backups = await api(rbase, '/api/v1/system/backups', { headers: { Cookie: rsession } });
        const entry = backups.body.data.find((item: any) => item.type === 'full-set');
        expect(entry).toMatchObject({ backupId: summary.backupId, state: 'complete' });
      } finally {
        await stopApp(restored.child);
        app = null;
      }

      process.stdout.write(`[drill] backupId=${summary.backupId} files=${summary.fileCount} bytes=${summary.bytes} backupMs=${summary.durationMs} restoreMs=${report.durationMs}\n`);
    } finally {
      if (app) await stopApp(app).catch(() => {});
    }
  }, 300000);
});
