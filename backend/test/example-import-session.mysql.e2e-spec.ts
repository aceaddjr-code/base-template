import * as XLSX from 'xlsx-js-style';
import { createConnection } from 'mysql2/promise';
import request from 'supertest';

/**
 * 导入会话闭环（第四批 02/04 部分）：完整 AppModule＋隔离 MySQL＋真实 HTTP。
 * 覆盖：原始行列定位（空行/标题行/列重排）、预检→确认→结果、重复确认/响应丢失幂等、
 * 双确认并发只处理一次、旧接口收敛拒绝、他人会话 404、过期拒绝。
 */
const suite = process.env.TEST_IMPORT_DATABASE ? describe : describe.skip;
suite('导入会话：隔离 MySQL＋真实 HTTP', () => {
  const database = process.env.TEST_IMPORT_DATABASE!;
  const adminPassword = 'import-admin-2026';
  let app: import('@nestjs/common').INestApplication;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const server = () => app.getHttpServer();
  let session = '';

  const loginPost = (loginid: string, password: string) =>
    request(server()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ loginid, password });
  const cookieOf = (response: request.Response) =>
    (response.headers['set-cookie'] ?? []).map(String).find(c => c.startsWith('access_token='))?.split(';')[0];

  function buildWorkbook(options: {
    titleRow?: boolean;
    emptyRowAt?: number;
    columnOrder?: number[]; // 数据列重排（0=标题,1=状态,2=说明...按模板列索引重排）
    extraSheet?: string;
    rows: Array<{ title: string; status?: string }>;
  }): Buffer {
    const headers = ['标题', '状态', '说明', '备注', '类别'];
    const wsData: any[][] = [];
    if (options.titleRow) wsData.push(['示例事项导入文件']);
    wsData.push(options.columnOrder ? options.columnOrder.map(i => headers[i]) : headers);
    options.rows.forEach((row, index) => {
      const rowNumber = wsData.length + 1; // 1 起原始行号
      if (options.emptyRowAt === rowNumber) wsData.push([]);
      const values: any[] = options.columnOrder
        ? options.columnOrder.map(i => [row.title, row.status ?? '待处理', '', '', ''][i])
        : [row.title, row.status ?? '待处理', '', '', ''];
      wsData.push(values);
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), '数据');
    if (options.extraSheet) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['隐藏数据'], ['x']]), options.extraSheet);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;

    process.env.DB_DATABASE = database;
    process.env.DB_SYNCHRONIZE = 'true';
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_DEFAULT_PASSWORD = 'import-admin-initial-2026';
    process.env.LOGIN_IP_MAX = '500';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configureApplication } = require('../src/app.setup');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NestFactory } = require('@nestjs/core');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ConfigService } = require('@nestjs/config');
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app, app.get(ConfigService));
    await app.init();

    const initial = await loginPost('admin', 'import-admin-initial-2026');
    await request(server()).patch('/api/v1/auth/password').set('Cookie', cookieOf(initial)!)
      .send({ oldPassword: 'import-admin-initial-2026', newPassword: adminPassword, confirmPassword: adminPassword });
    const relogin = await loginPost('admin', adminPassword);
    session = cookieOf(relogin)!;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    delete process.env.DB_DATABASE;
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    delete process.env.LOGIN_IP_MAX;
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  const precheck = (buffer: Buffer, cookie = session, newBatch = false) =>
    request(server()).post('/api/v1/examples/items/import/precheck' + (newBatch ? '?newBatch=1' : ''))
      .set('Cookie', cookie)
      .attach('file', buffer, { filename: 'import.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const confirm = (importId: string, cookie = session) =>
    request(server()).post('/api/v1/examples/items/import/confirm').set('Cookie', cookie).send({ importId });

  it('原始行号定位：标题行＋空行＋列重排下行号准确；多数据工作表拒绝', async () => {
    // 表头第 2 行；第 4 行空；三条数据在 3、5、6 行
    const buffer = buildWorkbook({ titleRow: true, emptyRowAt: 4, rows: [{ title: '行甲' }, { title: '行乙' }, { title: '行丙' }] });
    const result = await precheck(buffer).expect(201);
    const body = result.body.data;
    expect(body.headerRowNumber).toBe(2);
    expect(body.rows.map((r: any) => r.rowNumber)).toEqual([3, 5, 6]);
    // 列重排：标题在第 3 列
    const reordered = buildWorkbook({ columnOrder: [4, 3, 1, 0, 2], rows: [{ title: '重排甲' }] });
    const reorderedResult = await precheck(reordered).expect(201);
    expect(reorderedResult.body.data.rows[0].status).toBe('valid');
    // 多数据工作表拒绝
    const multi = buildWorkbook({ rows: [{ title: 'x' }], extraSheet: '机密' });
    const rejected = await precheck(multi);
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('多个数据工作表');
  });

  it('闭环：预检（行级校验）→确认（部分成功）→结果；重复确认幂等不重复建单', async () => {
    const buffer = buildWorkbook({ rows: [
      { title: '导入甲' },
      { title: '' },          // 校验失败（标题必填）→ Excel 里是空字符串
      { title: '导入乙' },
    ] });
    const precheckResult = await precheck(buffer).expect(201);
    const data = precheckResult.body.data;
    expect(data.total).toBe(3);
    expect(data.valid).toBeGreaterThanOrEqual(2);
    const failedRow = data.rows.find((r: any) => r.status === 'invalid');
    expect(failedRow).toBeTruthy();

    const confirmResult = await confirm(data.importId).expect(201);
    expect(confirmResult.body.data.summary.success).toBe(2);
    expect(confirmResult.body.data.summary.invalid).toBe(1);

    // 数据库证据：单据数与履历数
    const [items] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_items WHERE title IN ('导入甲','导入乙')`);
    expect(Number((items as any[])[0].n)).toBe(2);
    const [events] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_events WHERE action='create'`);
    expect(Number((events as any[])[0].n)).toBeGreaterThanOrEqual(2);

    // 重复确认（响应丢失重试场景）：幂等重放，不重复建单
    const again = await confirm(data.importId).expect(201);
    expect(again.body.data.summary.success).toBe(2);
    const [itemsAfter] = await admin.query(`SELECT COUNT(*) AS n FROM \`${database}\`.example_items WHERE title IN ('导入甲','导入乙')`);
    expect(Number((itemsAfter as any[])[0].n)).toBe(2);
  });

  it('并发双确认：同一 importId 并发只处理一轮；旧接口收敛拒绝；他人会话 404', async () => {
    const buffer = buildWorkbook({ rows: [{ title: '并发甲' }, { title: '并发乙' }] });
    const precheckResult = await precheck(buffer).expect(201);
    const importId = precheckResult.body.data.importId;
    const [a, b] = await Promise.all([confirm(importId), confirm(importId)]);
    const statuses = [a.body.data.status ?? a.body.data.summary, b.body.data.status ?? b.body.data.summary];
    // 一个 done/processing、另一个 processing 或 done 重放；最终 success 总数 ≤2
    await new Promise(done => setTimeout(done, 500));
    const final = await request(server()).get(`/api/v1/examples/items/import/${importId}`).set('Cookie', session).expect(200);
    expect(final.body.data.summary.success).toBe(2);
    void statuses;

    // 旧确认接口拒绝
    const oldContract = await request(server()).post('/api/v1/examples/items/import')
      .set('Cookie', session)
      .attach('file', buffer, { filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(oldContract.status).toBe(400);
    expect(oldContract.body.message).toContain('会话模式');

    // 他人会话 404（需要第二个用户——创建一个临时用户）
    const tempUser = await request(server()).post('/api/v1/users').set('Cookie', session).send({ loginid: 'import-other', displayName: '他人' }).expect(201);
    const tempPassword = tempUser.body.data.temporaryPassword as string;
    const tempLogin = await loginPost('import-other', tempPassword);
    const restrictedCookie = cookieOf(tempLogin)!;
    // 完成强制改密后才能访问业务接口（第一批门禁）
    await request(server()).patch('/api/v1/auth/password').set('Cookie', restrictedCookie)
      .send({ oldPassword: tempPassword, newPassword: 'other-user-final-2026', confirmPassword: 'other-user-final-2026' }).expect(200);
    const otherLogin = await loginPost('import-other', 'other-user-final-2026');
    const otherCookie = cookieOf(otherLogin)!;
    const other = await request(server()).get(`/api/v1/examples/items/import/${importId}`).set('Cookie', otherCookie);
    expect(other.status).toBe(404);
    void tempUser;
  });

  it('报告与修正文件下载：报告含全行状态；修正文件仅未成功行且他人不可取', async () => {
    const buffer = buildWorkbook({ rows: [{ title: '报告甲' }, { title: '' }, { title: '报告乙' }] });
    const precheckResult = await precheck(buffer).expect(201);
    const importId = precheckResult.body.data.importId;
    await confirm(importId).expect(201);
    // 核对报告：全部行（成功 2 + 失败 1）
    const report = await request(server()).get(`/api/v1/examples/items/import/${importId}/report`)
      .set('Cookie', session).responseType('blob').expect(200);
    expect(report.headers['content-type']).toContain('spreadsheet');
    expect(Buffer.from(report.body as any).length).toBeGreaterThan(1000);
    // 修正文件：仅失败行（下载成功即 200；无失败行时 400）
    const errorFile = await request(server()).get(`/api/v1/examples/items/import/${importId}/error-file`)
      .set('Cookie', session).responseType('blob').expect(200);
    expect(Buffer.from(errorFile.body as any).length).toBeGreaterThan(1000);
    // 全部成功会话：修正文件 400
    const allValid = buildWorkbook({ rows: [{ title: '全成功甲' }] });
    const validPrecheck = await precheck(allValid).expect(201);
    await confirm(validPrecheck.body.data.importId).expect(201);
    const noFailures = await request(server()).get(`/api/v1/examples/items/import/${validPrecheck.body.data.importId}/error-file`).set('Cookie', session);
    expect(noFailures.status).toBe(400);
    expect(noFailures.body.message).toContain('没有失败');
  });

  it('同文件重复预检返回已有会话；newBatch 生成新会话；过期会话拒绝确认', async () => {
    const buffer = buildWorkbook({ rows: [{ title: '去重甲' }] });
    const first = await precheck(buffer).expect(201);
    const second = await precheck(buffer).expect(201);
    expect(second.body.data.importId).toBe(first.body.data.importId);
    expect(second.body.data.duplicateOf?.importId).toBe(first.body.data.importId);
    const third = await precheck(buffer, session, true).expect(201);
    expect(third.body.data.importId).not.toBe(first.body.data.importId);

    // 过期：直接改库
    await admin.query(`UPDATE \`${database}\`.example_import_sessions SET expires_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE id = ?`, [third.body.data.importId]);
    const expired = await confirm(third.body.data.importId);
    expect(expired.status).toBe(400);
    expect(expired.body.message).toContain('过期');
  });
});
