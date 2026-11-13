import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { ExampleItemMember } from '../src/modules/example/example-member.entity';
import { ExampleEvent, ExampleChange } from '../src/modules/example/example-event.entity';
import { ExampleRecycle, ExampleReservedNumber } from '../src/modules/example/example-recycle.entity';
import { ExampleService } from '../src/modules/example/example.service';
import { ExampleController } from '../src/modules/example/example.controller';
import { ExampleImportService } from '../src/modules/example/example-import.service';
import { ExampleRecycleService } from '../src/modules/example/example-recycle.service';
import { NotificationOutbox } from '../src/modules/system/entities/notification-outbox.entity';
import { NotificationOutboxService } from '../src/modules/system/notification-outbox.service';
import { Attachment } from '../src/modules/attachment/attachment.entity';
import { AttachmentRecycle } from '../src/modules/attachment/attachment-recycle.entity';
import { AttachmentService } from '../src/modules/attachment/attachment.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { CsrfGuard } from '../src/common/guards/csrf.guard';
import { configureApplication } from '../src/app.setup';
import { excelToData } from '../src/common/utils/excel-helper';
import { User } from '../src/modules/user/user.entity';
import { Role } from '../src/modules/role/role.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { Department } from '../src/modules/department/department.entity';
import { SystemLog } from '../src/modules/system/entities/system-log.entity';

ConfigModule.forRoot({ envFilePath: '.env' });
const suite = process.env.TEST_MEMBERS_DATABASE ? describe : describe.skip;
suite('示例事项团队成员可见性 MySQL', () => {
  let db: DataSource, connection: Awaited<ReturnType<typeof createConnection>>, created = false;
  let docs: ExampleService, recycle: ExampleRecycleService, outbox: NotificationOutboxService;
  let httpApp: NestExpressApplication;
  const database = process.env.TEST_MEMBERS_DATABASE!;
  // A=7 操作者/负责人；B=8 团队成员；C=9 部门乙非成员；D=10 部门乙成员
  let currentUser: any = { sub: 7, username: 'a', dataScopes: [] as any[], accessCodes: [] as string[] };
  const scopeUser = (sub: number, scopeType: string, targets: number[] = [], accessCodes: string[] = []) =>
    ({ sub, dataScopes: [{ scopeKey: 'example-items', scopeType, targets }], accessCodes });
  let recycleScopes: any[] = [];

  beforeAll(async () => {
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离数据库');
    const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, multipleStatements: true };
    connection = await createConnection(config);
    const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
    if ((existing as any[]).length) throw Error('测试库已存在，拒绝覆盖');
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    db = await new DataSource({ type: 'mysql', ...config, username: config.user, database, synchronize: true, entities: [ExampleItem, ExampleItemMember, ExampleEvent, ExampleChange, ExampleRecycle, ExampleReservedNumber, Attachment, AttachmentRecycle, User, Role, Menu, Department, SystemLog, NotificationOutbox] }).initialize();
    await db.getRepository(Department).save([{ id: 10, name: '部门甲', code: 'dept-a' }, { id: 20, name: '部门乙', code: 'dept-b' }]);
    await db.getRepository(User).save([
      { id: 7, username: 'a', displayName: '张操作', deptId: 10, password: 'unused' },
      { id: 8, username: 'b', displayName: '李成员', deptId: 10, password: 'unused' },
      { id: 9, username: 'c', displayName: '王同事', deptId: 20, password: 'unused' },
      { id: 10, username: 'd', displayName: '赵队员', deptId: 20, password: 'unused' },
    ]);
    docs = new ExampleService(db.getRepository(ExampleItem), undefined, undefined, undefined, new NotificationOutboxService(db, db.getRepository(NotificationOutbox)));
    const files = new AttachmentService(db.getRepository(Attachment), new ConfigService({ ATTACHMENT_PRIVATE_DIR: mkdtempSync(join(tmpdir(), 'members-test-')) }), { write: async () => {} } as any);
    recycle = new ExampleRecycleService(db, files, { loadForSession: async () => recycleScopes } as any);
    const module = await Test.createTestingModule({
      controllers: [ExampleController],
      providers: [
        { provide: ExampleService, useValue: docs },
        { provide: ExampleImportService, useValue: {} },
        { provide: AuthService, useValue: { getUserAccessCodes: async () => currentUser.accessCodes } },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    httpApp = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    httpApp.use((req: any, _res: any, next: () => void) => { req.user = currentUser; next(); });
    configureApplication(httpApp, new ConfigService({}));
    await httpApp.init();
  }, 60000);

  afterAll(async () => {
    if (httpApp) await httpApp.close();
    if (db?.isInitialized) await db.destroy();
    // KEEP_TEST_DB=1 时保留测试库供失败排查，用完必须手工删除
    if (created && process.env.KEEP_TEST_DB !== '1') await connection.query(`DROP DATABASE \`${database}\``);
    await connection?.end();
  });

  const memberRows = (itemId: number) => db.getRepository(ExampleItemMember).find({ where: { itemId }, order: { id: 'ASC' } });

  it('创建带成员：去重落库、非法成员 400 字段级错误', async () => {
    const item = await docs.create({ title: '成员验收', memberIds: [8, 8, 10] } as any, 7, scopeUser(7, 'self'));
    expect((await memberRows(item.id)).map(row => row.userId)).toEqual([8, 10]);
    expect((item as any).memberIds).toEqual([8, 10]);
    await expect(docs.create({ title: '坏成员', memberIds: [999] } as any, 7, scopeUser(7, 'self')))
      .rejects.toMatchObject({ response: { fieldErrors: [{ path: 'memberIds', code: 'member-unknown' }] } });
  });

  it('成员（self 范围）列表与详情可见、memberIds 下发；非成员 404 且列表不可见', async () => {
    const item = await docs.create({ title: '可见性验收', memberIds: [8] } as any, 7, scopeUser(7, 'self'));
    const b = scopeUser(8, 'self', [], ['example-items:view']);
    const list = await docs.list({}, b);
    expect(list.list.map(row => row.id)).toContain(item.id);
    expect(list.list.find(row => row.id === item.id)?.memberIds).toEqual([8]);
    const detail = await docs.findOne(item.id, b);
    expect(detail.memberIds).toEqual([8]);
    const c = scopeUser(9, 'self', [], ['example-items:view']);
    expect((await docs.list({}, c)).list.map(row => row.id)).not.toContain(item.id);
    await expect(docs.findOne(item.id, c)).rejects.toThrow('记录不存在');
  });

  it('参与者直通：无 update 码 HTTP 403；有 update 码即可编辑（无 -others）；有 delete 码即可删除', async () => {
    const item = await docs.create({ title: '直通验收', memberIds: [8] } as any, 7, scopeUser(7, 'self'));
    currentUser = { sub: 8, username: 'b', dataScopes: [{ scopeKey: 'example-items', scopeType: 'self' }], accessCodes: ['example-items:view'] };
    await request(httpApp.getHttpServer()).put(`/api/v1/examples/items/${item.id}`).send({ title: '越权编辑', version: item.version }).expect(403);
    currentUser = { ...currentUser, accessCodes: ['example-items:view', 'example-items:update'] };
    await request(httpApp.getHttpServer()).put(`/api/v1/examples/items/${item.id}`).send({ title: '成员编辑', version: item.version }).expect(200);
    // 成员自身可见变更后的版本
    const detail = await docs.findOne(item.id, scopeUser(8, 'self'));
    expect(detail.title).toBe('成员编辑');
    currentUser = { ...currentUser, accessCodes: ['example-items:view', 'example-items:delete'] };
    await request(httpApp.getHttpServer()).delete(`/api/v1/examples/items/${item.id}`).expect(200);
    await db.getRepository(ExampleRecycle).delete(item.id);
    await db.getRepository(ExampleItem).delete(item.id);
  });

  it('成员变更：版本+1、修改日志含团队成员 diff、新成员收通知、移出不通知；清空成员后失去可见', async () => {
    const item = await docs.create({ title: '变更验收' } as any, 7, scopeUser(7, 'self'));
    const updated = await docs.update(item.id, { version: item.version, memberIds: [9, 10] } as any, 7, scopeUser(7, 'self'));
    expect(updated.version).toBe(item.version + 1);
    const event = await db.getRepository(ExampleEvent).findOne({ where: { itemId: item.id, action: 'update' }, order: { id: 'DESC' } });
    const change = await db.getRepository(ExampleChange).findOne({ where: { eventId: event!.id, fieldKey: 'memberIds' } });
    expect(change).toMatchObject({ beforeLabel: null, afterLabel: '王同事、赵队员', beforeValue: [], afterValue: [9, 10] });
    const notices = await db.getRepository(NotificationOutbox).find({ where: { type: 'member-added', bizId: item.id } });
    expect(notices.map(row => row.recipientId).sort((a, b) => a - b)).toEqual([9, 10]);
    const itemNotices = () => db.getRepository(NotificationOutbox).count({ where: { type: 'member-added', bizId: item.id } });
    // 操作者把自己加入成员：不发通知；重复提交相同成员：no_change 不再推进版本
    const before = notices.length;
    await docs.update(item.id, { version: updated.version, memberIds: [7, 9, 10] } as any, 7, scopeUser(7, 'self'));
    expect(await itemNotices()).toBe(before);
    const again = await docs.update(item.id, { version: updated.version + 1, memberIds: [7, 9, 10] } as any, 7, scopeUser(7, 'self'));
    expect(again.version).toBe(updated.version + 1);
    // 移出成员不产生通知；被移出的 C（self 范围）失去可见
    await docs.update(item.id, { version: again.version, memberIds: [10] } as any, 7, scopeUser(7, 'self'));
    expect(await itemNotices()).toBe(before);
    await expect(docs.findOne(item.id, scopeUser(9, 'self'))).rejects.toThrow('记录不存在');
    // 部门乙成员叠加：D（by_depts 部门 20，负责人在部门甲）经成员分支可见；同部门非成员 C 不可见
    const d = scopeUser(10, 'by_depts', [20], ['example-items:view']);
    expect((await docs.list({}, d)).list.map(row => row.id)).toContain(item.id);
    expect((await docs.list({}, scopeUser(9, 'by_depts', [20]))).list.map(row => row.id)).not.toContain(item.id);
  });

  it('导出投影团队成员为顿号姓名', async () => {
    const item = await docs.create({ title: '导出验收', memberIds: [8, 10] } as any, 7, scopeUser(7, 'self'));
    const exported = await docs.exportExcel(scopeUser(7, 'self'), { cols: ['memberIds'] });
    const rows = await excelToData(exported.buffer, { memberIds: ['团队成员'] } as any);
    expect(rows.map((row: any) => row.memberIds)).toContain('李成员、赵队员');
    await docs.remove(item.id, scopeUser(7, 'self'));
    // 成员（self 范围）可见自己参与单据的回收记录，并可恢复（无需 recycle -others 码）
    recycleScopes = [{ scopeKey: 'example-items', scopeType: 'self' }];
    const b = { sub: 8, username: 'b', accessCodes: ['recycle-bin:restore'] } as any;
    const recycleList = await recycle.list(b, 1, 20);
    expect(recycleList.list.map(row => row.id)).toContain(item.id);
    await recycle.restore(item.id, b);
    expect(await docs.findOne(item.id, scopeUser(8, 'self'))).toMatchObject({ id: item.id, deletedAt: null });
    // 彻底删除：成员行物理清理，成员不再可见
    await docs.remove(item.id, scopeUser(7, 'self'));
    await recycle.purge(item.id, { sub: 8, username: 'b', accessCodes: ['recycle-bin:purge'] } as any);
    expect(await memberRows(item.id)).toEqual([]);
    await expect(docs.findOne(item.id, scopeUser(8, 'self'))).rejects.toThrow('记录不存在');
  });
});
