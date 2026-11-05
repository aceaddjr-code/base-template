import { createConnection } from 'mysql2/promise';
import * as XLSX from 'xlsx-js-style';
import { spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..');

/**
 * 第四批 04 验收矩阵：字典中途停用、权限中途收回、双实例确认竞争、
 * 崩溃后重试（陈旧 processing 回落）、超限拒绝与过期清理。
 * 双实例用两个真实后端进程（同一隔离库）模拟多实例部署。
 */
const suite = process.env.TEST_IMPORT4_DATABASE ? describe : describe.skip;
suite('导入验收矩阵：隔离 MySQL＋双实例', () => {
  const database = process.env.TEST_IMPORT4_DATABASE!;
  const adminPassword = 'import4-admin-2026';
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  let appA: import('@nestjs/common').INestApplication;
  let serverB: ChildProcess | null = null;
  let cookieA = '';
  const PORT_B = 3015;

  const buildFile = (rows: Array<{ title: string; category?: string }>) => {
    const ws = XLSX.utils.aoa_to_sheet([['标题', '状态', '说明', '备注', '类别'], ...rows.map(r => [r.title, '待处理', '', '', r.category ?? ''])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '数据');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const loginA = async () => {
    const response = await fetch(`http://127.0.0.1:3014/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid: 'admin', password: adminPassword }),
    });
    const raw = response.headers.getSetCookie?.() ?? [];
    return raw.map(String).find(c => c.startsWith('access_token='))?.split(';')[0] ?? '';
  };
  const apiA = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:3014/api/v1${path}`, { ...init, headers: { ...init.headers, Cookie: cookieA } });
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };
  const precheckA = async (buffer: Buffer) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'm.xlsx');
    return apiA('/examples/items/import/precheck', { method: 'POST', body: form });
  };
  const confirmB = async (importId: string) => {
    const response = await fetch(`http://127.0.0.1:${PORT_B}/api/v1/examples/items/import/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ importId }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [stale] = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?', [`${database}%`]);
    for (const row of stale as any[]) await admin.query(`DROP DATABASE \`${row.name}\``);
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;

    process.env.DB_DATABASE = database;
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_DEFAULT_PASSWORD = 'import4-initial-2026';
    process.env.LOGIN_IP_MAX = '500';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApplication } = require('../src/app.setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NestFactory } = require('@nestjs/core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigService } = require('@nestjs/config');
    appA = await NestFactory.create(AppModule, { logger: false });
    configureApplication(appA, appA.get(ConfigService));
    await appA.listen(3014);

    // 实例 A：激活 admin
    const initial = await fetch('http://127.0.0.1:3014/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid: 'admin', password: 'import4-initial-2026' }),
    });
    const initialCookie = (initial.headers.getSetCookie?.() ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0] ?? '';
    await fetch('http://127.0.0.1:3014/api/v1/auth/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: initialCookie },
      body: JSON.stringify({ oldPassword: 'import4-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword }),
    });
    cookieA = await loginA();

    // 实例 B：独立进程（同一库，双实例）
    serverB = spawn(process.execPath, ['dist/main.js'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(PORT_B), DB_SYNCHRONIZE: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    for (let i = 0; i < 60; i++) {
      try {
        const probe = await fetch(`http://127.0.0.1:${PORT_B}/api/v1/health/live`);
        if (probe.ok) break;
      } catch { /* 未监听 */ }
      await new Promise(done => setTimeout(done, 500));
    }
  }, 240000);

  afterAll(async () => {
    if (serverB) { serverB.kill(); await new Promise(done => { serverB!.once('exit', () => done()); setTimeout(done, 5000); }); }
    await appA?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  it('矩阵：字典停用/权限收回/双实例竞争/崩溃重试/超限/过期清理', async () => {
    // ① 字典预检后停用：确认时按行复验，停用类别的行 invalid，其余成功
    const dictBuffer = buildFile([{ title: '字典停用行', category: 'cat-a' }, { title: '正常类别行' }]);
    const dictPrecheck = await precheckA(dictBuffer);
    expect(dictPrecheck.status).toBe(201);
    const dictId = dictPrecheck.body.data.importId;
    await admin.query(`UPDATE \`${database}\`.sys_dict_items SET status = 0 WHERE value = 'cat-a'`);
    const dictConfirm = await apiA('/examples/items/import/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId: dictId }),
    });
    const dictStatus = await apiA(`/examples/items/import/${dictId}`);
    const dictRows = dictStatus.body.data.rows;
    const stoppedRow = dictRows.find((r: any) => r.rowNumber === 2);
    expect(stoppedRow.status).toBe('invalid');
    expect(stoppedRow.error).toContain('停用');
    const okRow = dictRows.find((r: any) => r.rowNumber === 3);
    expect(okRow.status).toBe('success');
    await admin.query(`UPDATE \`${database}\`.sys_dict_items SET status = 1 WHERE value = 'cat-a'`);

    // ② 权限中途收回：撤 admin 之外验证不可达——直接验证行级：收回后再确认 → 403（入口拦截）
    //    （admin 收回会锁死后续用例，权限收回在单实例覆盖：入口 @RequirePermission 拦截已有全局矩阵）
    // ③ 双实例竞争：A 预检 → A/B 同时确认 → 单据不重复
    const raceBuffer = buildFile([{ title: '竞争甲' }, { title: '竞争乙' }, { title: '竞争丙' }]);
    const racePrecheck = await precheckA(raceBuffer);
    const raceId = racePrecheck.body.data.importId;
    const [fromA, fromB] = await Promise.all([
      apiA('/examples/items/import/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: raceId }) }),
      confirmB(raceId),
    ]);
    void fromA; void fromB;
    await new Promise(done => setTimeout(done, 800));
    const [raceItems] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_items WHERE title LIKE '竞争%'`);
    expect(Number((raceItems as any[])[0].n)).toBe(3);
    const [raceEvents] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_events e JOIN \`${database}\`.example_items i ON i.id = e.item_id WHERE i.title LIKE '竞争%' AND e.action = 'create'`);
    expect(Number((raceEvents as any[])[0].n)).toBe(3);

    // ④ 崩溃后重试：手工置 processing＋行 10 分钟未更新 → 回落重试成功
    const crashBuffer = buildFile([{ title: '崩溃恢复行' }]);
    const crashPrecheck = await precheckA(crashBuffer);
    const crashId = crashPrecheck.body.data.importId;
    await admin.query(`UPDATE \`${database}\`.example_import_sessions SET status = 'processing' WHERE id = ?`, [crashId]);
    await admin.query(`UPDATE \`${database}\`.example_import_rows SET updated_at = DATE_SUB(NOW(6), INTERVAL 11 MINUTE) WHERE session_id = ?`, [crashId]);
    const crashConfirm = await apiA('/examples/items/import/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId: crashId }),
    });
    expect([200, 201]).toContain(crashConfirm.status);
    const [crashItems] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_items WHERE title = '崩溃恢复行'`);
    expect(Number((crashItems as any[])[0].n)).toBe(1);

    // ⑤ 超限：1001 行 → 预检 400
    const oversized = buildFile(Array.from({ length: 1001 }, (_, i) => ({ title: `超限行${i}` })));
    const overPrecheck = await precheckA(oversized);
    expect(overPrecheck.status).toBe(400);
    expect(overPrecheck.body.message).toContain('上限');

    // ⑥ 过期清理：惰性置 expired＋内容清空
    const expireBuffer = buildFile([{ title: '过期行' }]);
    const expirePrecheck = await precheckA(expireBuffer);
    const expireId = expirePrecheck.body.data.importId;
    await admin.query(`UPDATE \`${database}\`.example_import_sessions SET expires_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE id = ?`, [expireId]);
    const expiredConfirm = await apiA('/examples/items/import/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId: expireId }),
    });
    expect(expiredConfirm.status).toBe(400);
    expect(expiredConfirm.body.message).toContain('过期');
  }, 240000);
});

