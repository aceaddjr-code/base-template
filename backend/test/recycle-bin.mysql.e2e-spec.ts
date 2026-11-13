import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { ExampleItemMember } from '../src/modules/example/example-member.entity';
import { ExampleRecycle, ExampleReservedNumber } from '../src/modules/example/example-recycle.entity';
import { ExampleEvent, ExampleChange } from '../src/modules/example/example-event.entity';
import { ExampleService } from '../src/modules/example/example.service';
import { ExampleRecycleService } from '../src/modules/example/example-recycle.service';
import { ExampleRecycleController } from '../src/modules/example/example-recycle.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { Attachment } from '../src/modules/attachment/attachment.entity';
import { AttachmentService } from '../src/modules/attachment/attachment.service';
import { AttachmentRecycle } from '../src/modules/attachment/attachment-recycle.entity';
import { AttachmentRecycleService } from '../src/modules/example/attachment-recycle.service';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { configureApplication } from '../src/app.setup';
import { User } from '../src/modules/user/user.entity';
import { Role } from '../src/modules/role/role.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { Department } from '../src/modules/department/department.entity';
import { SystemLog } from '../src/modules/system/entities/system-log.entity';

ConfigModule.forRoot({ envFilePath: '.env' });
const suite = process.env.TEST_RECYCLE_DATABASE ? describe : describe.skip;
suite('回收站隔离 MySQL 生命周期', () => {
  let db: DataSource, connection: Awaited<ReturnType<typeof createConnection>>, created = false;
  let docs: ExampleService, recycle: ExampleRecycleService, files: AttachmentService;
  let recycledFiles: AttachmentRecycleService;
  let httpApp: NestExpressApplication;
  const root = mkdtempSync(join(tmpdir(), 'recycle-test-'));
  const user: any = { sub: 7, username: 'tester', roleCode: 'user' };
  let scopes: any[] = [];
  const database = process.env.TEST_RECYCLE_DATABASE!;
  beforeAll(async () => {
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离数据库');
    const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, multipleStatements: true };
    connection = await createConnection(config);
    const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
    if ((existing as any[]).length) throw Error('测试库已存在，拒绝覆盖');
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    db = await new DataSource({ type: 'mysql', ...config, username: config.user, database, synchronize: true, entities: [ExampleItem, ExampleItemMember, ExampleRecycle, ExampleReservedNumber, ExampleEvent, ExampleChange, Attachment, AttachmentRecycle, User, Role, Menu, Department, SystemLog] }).initialize();
    await db.getRepository(Menu).save({ name: '工作协同', path: '/collaboration', type: 'menu', status: 1 });
    await connection.changeUser({ database });
    await connection.query('ALTER TABLE attachments DROP COLUMN recycle_held');
    const sql = readFileSync(join('..', 'docs', 'sql', '20261103-recycle-bin.sql'), 'utf8');
    await connection.query(sql); await connection.query(sql);
    await connection.query('DROP TABLE attachment_recycle');
    const attachmentSql = readFileSync(join('..', 'docs', 'sql', '20261103-attachment-recycle.sql'), 'utf8');
    await connection.query(attachmentSql); await connection.query(attachmentSql);
    await db.getRepository(User).save({ id: 7, username: 'tester', displayName: '测试人', password: 'unused' });
    files = new AttachmentService(db.getRepository(Attachment), new ConfigService({ ATTACHMENT_PRIVATE_DIR: root }), { write: async () => {} } as any);
    docs = new ExampleService(db.getRepository(ExampleItem), undefined, db.getRepository(Attachment), files);
    recycle = new ExampleRecycleService(db, files, { loadForSession: async () => scopes } as any);
    recycledFiles = new AttachmentRecycleService(db, files, { loadForSession: async () => scopes } as any);
    // E1：HTTP 层挂真实控制器与守卫链（CsrfGuard + PermissionGuard + 统一异常过滤器），身份由中间件注入（JWT 守卫不在本验证范围）。
    const module = await Test.createTestingModule({
      controllers: [ExampleRecycleController],
      providers: [
        { provide: ExampleRecycleService, useValue: recycle },
        { provide: AttachmentRecycleService, useValue: recycledFiles },
        { provide: AuthService, useValue: { getUserAccessCodes: async () => user.accessCodes } },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    httpApp = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    httpApp.use((req: any, _res: any, next: () => void) => { req.user = user; next(); });
    configureApplication(httpApp, new ConfigService({ ATTACHMENT_PRIVATE_DIR: root }));
    await httpApp.init();
  }, 30000);
  afterAll(async () => {
    if (httpApp) await httpApp.close();
    if (db?.isInitialized) await db.destroy();
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection?.end();
  });
  beforeEach(() => {
    scopes = [];
    user.accessCodes = ['recycle-bin:restore', 'recycle-bin:purge', 'recycle-bin:restore-others', 'recycle-bin:purge-others'];
  });
  async function fixture() {
    const item = await docs.create({ title: '回收站验收', status: 'done' }, 7, user);
    const path = `${item.id}.txt`; writeFileSync(join(root, path), '附件');
    const attachment = await db.getRepository(Attachment).save({ originalName: path, storagePath: path, size: 6, mimeType: 'text/plain', origin: 'business', entityType: 'example-items', entityId: item.id, status: 'bound', ownerId: 7 });
    return { item, attachment, path };
  }
  it('只有查看权限不能恢复本人；只有恢复权限不能改用批量彻底删除', async () => {
    const { item } = await fixture();
    await docs.remove(item.id, user);
    user.accessCodes = ['example-items:view'];
    const endpoint = '/api/v1/recycle-bin/batch';
    await request(httpApp.getHttpServer()).post(endpoint).send({ ids: [item.id], action: 'restore' }).expect(403);
    user.accessCodes = ['recycle-bin:restore'];
    await request(httpApp.getHttpServer()).post(endpoint).send({ ids: [item.id], action: 'purge' }).expect(403);
    const restored = await request(httpApp.getHttpServer()).post(endpoint).send({ ids: [item.id], action: 'restore' }).expect(201);
    expect(restored.body.data[0]).toMatchObject({ id: item.id, success: true });
  });
  it('历史软删不纳入；新删除记录及附件永久保留并完整恢复，追加恢复履历', async () => {
    const legacy = await db.getRepository(ExampleItem).save({ title: '旧删除', ownerId: 7 });
    await db.getRepository(ExampleItem).softDelete(legacy.id);
    const { item, attachment, path } = await fixture();
    // 单据删除前已单独移除的附件不能随单据恢复。
    const old = await db.getRepository(Attachment).save({ originalName: 'old', storagePath: 'old.txt', size: 1, mimeType: 'text/plain', origin: 'business', entityType: 'example-items', entityId: item.id, status: 'bound' });
    await db.getRepository(Attachment).softDelete(old.id);
    await docs.remove(item.id, user);
    expect((await recycle.list(user, 1, 100)).list.map(e => e.id)).toContain(item.id);
    expect((await recycle.list(user, 1, 100)).list.map(e => e.id)).not.toContain(legacy.id);
    await files.sweepDeletedFiles(); expect(existsSync(join(root, path))).toBe(true);
    expect((await recycle.detail(item.id, user)).attachments.map(a => a.id)).toEqual([attachment.id]);
    await recycle.restore(item.id, user);
    expect(await db.getRepository(ExampleItem).findOneBy({ id: item.id })).toMatchObject({ docNo: item.docNo, status: 'done', ownerId: 7, version: 2 });
    expect(await db.getRepository(Attachment).findOneBy({ id: attachment.id })).toMatchObject({ recycleHeld: 0 });
    expect(await db.getRepository(Attachment).findOneBy({ id: old.id })).toBeNull();
    expect(await db.getRepository(ExampleEvent).countBy({ itemId: item.id, action: 'restore' })).toBe(1);
  });
  it('当前数据范围、本人编辑开关逐次生效，不能绕过；缺失文件时整单不恢复', async () => {
    const { item, attachment } = await fixture(); await docs.remove(item.id, user);
    scopes = [{ scopeKey: 'example-items', scopeType: 'self', editSelf: 0 }];
    await expect(recycle.restore(item.id, user)).rejects.toThrow('单据不存在');
    scopes = [];
    files.eraseFile(attachment);
    await expect(recycle.restore(item.id, user)).rejects.toThrow('附件文件缺失');
    expect(await db.getRepository(ExampleItem).findOneBy({ id: item.id })).toBeNull();
  });
  it('批量允许部分成功，彻底删除正文/附件/履历，编号永久不复用', async () => {
    const { item, path } = await fixture(); await docs.remove(item.id, user);
    const results = await recycle.batch([item.id, 2147483647], 'purge', user);
    expect(results.map(r => r.success)).toEqual([true, false]);
    expect(existsSync(join(root, path))).toBe(false);
    expect(await db.getRepository(ExampleItem).findOne({ where: { id: item.id }, withDeleted: true })).toBeNull();
    expect(await db.getRepository(ExampleEvent).countBy({ itemId: item.id })).toBe(0);
    expect(await db.getRepository(SystemLog).countBy({ entityId: item.id, action: 'purge' })).toBe(1);
    const next = await docs.create({ title: '彻底删除后新建' }, 7, user);
    expect(Number(next.docNo!.split('-').at(-1))).toBeGreaterThan(Number(item.docNo!.split('-').at(-1)));
  });
  it('部门范围在 SQL 中限制列表及直接 ID 访问，负责人调部门后立即改变可见性', async () => {
    const dept = await db.getRepository(Department).save({ name: '测试部门', code: 'recycle-test', status: 1 });
    const owner = await db.getRepository(User).save({ username: 'other', password: 'unused', deptId: dept.id });
    const item = await db.getRepository(ExampleItem).save({ title: '其他人事项', ownerId: owner.id });
    await docs.remove(item.id, { sub: 7, roles: ['admin'] });
    scopes = [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [dept.id], viewOthers: 1, editOthers: 1, deleteOthers: 1 }];
    expect((await recycle.list(user, 1, 100)).list.map(e => e.id)).toContain(item.id);
    await db.getRepository(User).update(owner.id, { deptId: null });
    expect((await recycle.list(user, 1, 100)).list.map(e => e.id)).not.toContain(item.id);
    await expect(recycle.detail(item.id, user)).rejects.toThrow('单据不存在');
    await expect(recycle.restore(item.id, user)).rejects.toThrow('单据不存在');
    await expect(recycle.purge(item.id, user)).rejects.toThrow('单据不存在');
  });
  it('E1：范围外已删单据的 HTTP 恢复请求返回 404，不出错也不泄露存在性', async () => {
    const deptB = await db.getRepository(Department).save({ name: 'B部门', code: 'recycle-dept-b', status: 1 });
    const ownerB = await db.getRepository(User).save({ username: 'owner-b', password: 'unused', deptId: deptB.id });
    const outside = await db.getRepository(ExampleItem).save({ title: '范围外已删单据', ownerId: ownerB.id });
    await docs.remove(outside.id, { sub: 7, roles: ['admin'] });
    // 当前用户范围限定在另一个部门（不含 deptB），对范围外单据发 HTTP 恢复请求。
    scopes = [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [0], viewOthers: 1, editOthers: 1, deleteOthers: 1 }];
    const res = await request(httpApp.getHttpServer())
      .post('/api/v1/recycle-bin/batch')
      .set('Content-Type', 'application/json')
      .send({ ids: [outside.id], action: 'restore' });
    // 批量端点为逐条结果语义（HTTP 201），范围外条目必须失败且只给 404 语义文案，不泄露单据细节。
    expect(res.status).toBe(201);
    expect(res.body.data[0]).toMatchObject({ id: outside.id, success: false, reason: '单据不存在或不在当前操作范围内' });
    // 单据仍在回收站（未被越权恢复），正文未动。
    expect(await db.getRepository(ExampleRecycle).findOneBy({ itemId: outside.id })).not.toBeNull();
    expect(await db.getRepository(ExampleItem).findOne({ where: { id: outside.id }, withDeleted: true })).not.toBeNull();
    // 同请求的 detail 直接 ID 访问同样 404。
    const detail = await request(httpApp.getHttpServer()).get(`/api/v1/recycle-bin/${outside.id}`);
    expect(detail.status).toBe(404);
  });
  it('并发恢复只执行一次；彻底删除磁盘失败后禁止恢复并允许重试', async () => {
    const { item } = await fixture(); await docs.remove(item.id, user);
    const result = await Promise.allSettled([recycle.restore(item.id, user), recycle.restore(item.id, user)]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.getRepository(ExampleEvent).countBy({ itemId: item.id, action: 'restore' })).toBe(1);
    await docs.remove(item.id, user);
    const spy = jest.spyOn(files, 'eraseFile').mockImplementationOnce(() => { throw Error('磁盘失败') });
    await expect(recycle.purge(item.id, user)).rejects.toThrow('磁盘失败'); spy.mockRestore();
    await expect(recycle.restore(item.id, user)).rejects.toThrow('已开始彻底删除');
    await recycle.purge(item.id, user);
    expect(await db.getRepository(ExampleRecycle).findOneBy({ itemId: item.id })).toBeNull();
  });
  it('独立删除文件库文件保留磁盘，恢复及彻底删除，列表按数据范围过滤', async () => {
    writeFileSync(join(root, 'library.txt'), 'data');
    const row = await db.getRepository(Attachment).save({ originalName: 'library.txt', storagePath: 'library.txt', size: 4, mimeType: 'text/plain', origin: 'center', status: 'temp', ownerId: 7, createdBy: 7 });
    await files.remove(row.id, user);
    await files.sweepDeletedFiles(); expect(existsSync(join(root, 'library.txt'))).toBe(true);
    expect((await recycledFiles.list(user, 1, 20)).list.map(r => r.id)).toContain(row.id);
    scopes = [{ scopeKey: 'attachments', scopeType: 'self', viewSelf: 0 }];
    expect((await recycledFiles.list(user, 1, 20)).list.map(r => r.id)).not.toContain(row.id);
    scopes = [];
    await recycledFiles.restore(row.id, user);
    expect(await db.getRepository(Attachment).findOneBy({ id: row.id })).toMatchObject({ recycleHeld: 0 });
    await files.remove(row.id, user); await recycledFiles.purge(row.id, user);
    expect(existsSync(join(root, 'library.txt'))).toBe(false);
    expect(await db.getRepository(SystemLog).countBy({ entityType: 'attachments', entityId: row.id, action: 'purge' })).toBe(1);
  });
  it('单独删除的业务附件跟随单据范围；先恢复单据再恢复附件，彻底删除单据前先处理附件', async () => {
    const { item, attachment, path } = await fixture();
    await docs.removeFile(item.id, attachment.id, user); await docs.remove(item.id, user);
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).toContain(attachment.id);
    await expect(recycledFiles.restore(attachment.id, user)).rejects.toThrow('请先恢复所属单据');
    await expect(recycle.purge(item.id, user)).rejects.toThrow('请先在文件回收站处理');
    await recycle.restore(item.id, user);
    expect(await db.getRepository(Attachment).findOneBy({ id: attachment.id })).toBeNull();
    await recycledFiles.restore(attachment.id, user);
    expect(existsSync(join(root, path))).toBe(true);
    expect(await db.getRepository(Attachment).findOneBy({ id: attachment.id })).toMatchObject({ recycleHeld: 0 });
    expect(await db.getRepository(ExampleEvent).countBy({ itemId: item.id, action: 'attachment_restore' })).toBe(1);
  });
  it('文件回收遵循部门范围及操作开关，并在权限变化后拒绝直接访问', async () => {
    const dept = await db.getRepository(Department).save({ name: '文件测试部门', code: 'recycle-files', status: 1 });
    const owner = await db.getRepository(User).save({ username: 'file-owner', password: 'unused', deptId: dept.id });
    writeFileSync(join(root, 'scope.txt'), 'data');
    const row = await db.getRepository(Attachment).save({ originalName: 'scope.txt', storagePath: 'scope.txt', size: 4, mimeType: 'text/plain', origin: 'center', status: 'temp', ownerId: owner.id, createdBy: owner.id });
    await files.remove(row.id, { sub: 7, username: 'tester', roleCode: 'admin' } as any);
    scopes = [{ scopeKey: 'attachments', scopeType: 'by_depts', targets: [dept.id], viewOthers: 1, editOthers: 0, deleteOthers: 0 }];
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).toContain(row.id);
    await expect(recycledFiles.restore(row.id, user)).rejects.toThrow('文件不存在');
    scopes[0].editOthers = 1;
    await db.getRepository(User).update(owner.id, { deptId: null });
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).not.toContain(row.id);
    await expect(recycledFiles.restore(row.id, user)).rejects.toThrow('文件不存在');
    scopes = [{ scopeKey: 'attachments', scopeType: 'by_users', targets: [owner.id], viewOthers: 1, editOthers: 1, deleteOthers: 1 }];
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).toContain(row.id);
    const results = await recycledFiles.batch([row.id, 2147483647], 'restore', user);
    expect(results.map(r => r.success)).toEqual([true, false]);
  });
  it('已挂接文件使用单据当前负责人及部门范围，而非附件上传人范围', async () => {
    const dept = await db.getRepository(Department).save({ name: '业务附件部门', code: 'recycle-bound', status: 1 });
    const owner = await db.getRepository(User).save({ username: 'bound-owner', password: 'unused', deptId: dept.id });
    const item = await db.getRepository(ExampleItem).save({ title: '业务范围单据', ownerId: owner.id, version: 1 });
    writeFileSync(join(root, 'bound-scope.txt'), 'data');
    const row = await db.getRepository(Attachment).save({ originalName: 'bound-scope.txt', storagePath: 'bound-scope.txt', size: 4, mimeType: 'text/plain', origin: 'business', status: 'bound', entityType: 'example-items', entityId: item.id, ownerId: 7, createdBy: 7 });
    await docs.removeFile(item.id, row.id, { sub: 7, username: 'tester', roleCode: 'admin' });
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).not.toContain(row.id);
    scopes = [{ scopeKey: 'example-items', scopeType: 'by_depts', targets: [dept.id], viewOthers: 1, editOthers: 1, deleteOthers: 1 }];
    expect((await recycledFiles.list(user, 1, 100)).list.map(r => r.id)).toContain(row.id);
    await db.getRepository(User).update(owner.id, { deptId: null });
    await expect(recycledFiles.restore(row.id, user)).rejects.toThrow('文件不存在');
  });
});
