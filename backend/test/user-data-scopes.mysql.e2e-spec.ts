import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { User } from '../src/modules/user/user.entity';
import { Role } from '../src/modules/role/role.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { Department } from '../src/modules/department/department.entity';
import { UserDataScope } from '../src/modules/user/user-data-scope.entity';
import { UserDataScopeTarget } from '../src/modules/user/user-data-scope-target.entity';
import { UserDataScopeService } from '../src/modules/user/user-data-scope.service';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { CrudBaseService } from '../src/common/services/crud-base.service';
import { ScopeUser, UserScopeEntry } from '../src/common/utils/data-scope';
import { excelToData } from '../src/common/utils/excel-helper';

class ScopedItems extends CrudBaseService<ExampleItem> {
  protected dataScopeKey = 'example-items';
  constructor(db: DataSource) { super(db.getRepository(ExampleItem), {}, { filterableFields: ['title'], excelColumns: [{ key: 'title', header: '标题' }] }); }
  lockedRead(db: DataSource, id: number, actor: ScopeUser, op: 'view' | 'edit' | 'delete') {
    return db.transaction(manager => this.findOneForWrite(manager, id, actor, op));
  }
}
const suite = process.env.TEST_SCOPE_DATABASE ? describe : describe.skip;
suite('共同范围及六个操作开关：隔离 MySQL', () => {
  let db: DataSource, connection: Awaited<ReturnType<typeof createConnection>>, created = false;
  let service: ScopedItems, scopes: UserDataScopeService;
  let migratedRow: Record<string, unknown>;
  const database = process.env.TEST_SCOPE_DATABASE!;
  const shared: UserScopeEntry = { scopeKey: 'example-items', scopeType: 'by_depts', targets: [10], viewOthers: 1, editOthers: 0, deleteOthers: 0, viewSelf: 1, editSelf: 1, deleteSelf: 0 };
  const actor = (flags: Partial<UserScopeEntry> = {}): ScopeUser => ({ sub: 2, dataScopes: [{ ...shared, ...flags }] });
  beforeAll(async () => {
    const host = process.env.DB_HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('只允许本地全新隔离库');
    const config = { host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, multipleStatements: true };
    connection = await createConnection(config);
    const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
    if ((existing as any[]).length) throw Error('拒绝覆盖已有库');
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    await connection.changeUser({ database });
    db = await new DataSource({ type: 'mysql', ...config, username: config.user, database, entities: [User, Role, Menu, Department, UserDataScope, UserDataScopeTarget, ExampleItem], synchronize: true }).initialize();
    await connection.query('ALTER TABLE user_data_scopes DROP COLUMN view_self, DROP COLUMN edit_self, DROP COLUMN delete_self');
    await connection.query("INSERT INTO user_data_scopes (user_id,scope_key,scope_type,view_others,edit_others,delete_others) VALUES (2,'__global__','by_users',1,0,1)");
    const migration = readFileSync(resolve('..', 'docs/sql/20261102-user-data-scope-self-permissions.sql'), 'utf8');
    await connection.query(migration); await connection.query(migration);
    const [migrated] = await connection.query<any[]>('SELECT scope_type,view_others,edit_others,delete_others,view_self,edit_self,delete_self FROM user_data_scopes WHERE user_id=2');
    migratedRow = migrated[0];
    await db.getRepository(Department).save([{ id: 10, name: '部门A', code: 'a' }, { id: 11, name: 'A下级', code: 'a-child', parentId: 10 }, { id: 20, name: '部门B', code: 'b' }]);
    await db.getRepository(User).save([2, 7, 8, 9].map(id => ({ id, username: `u${id}`, password: 'unused-test-only', deptId: id === 7 ? 11 : id === 8 ? 10 : 20 })));
    service = new ScopedItems(db);
    scopes = new UserDataScopeService(db.getRepository(UserDataScope), db.getRepository(UserDataScopeTarget), db.getRepository(User), db.getRepository(Department));
  }, 30000);
  beforeEach(async () => {
    await db.getRepository(ExampleItem).clear();
    await db.getRepository(ExampleItem).save([2, 7, 8, 9].map(id => ({ id, title: `事项${id}`, ownerId: id })));
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); if (created) await connection.query(`DROP DATABASE \`${database}\``); await connection?.end(); });

  it('重复执行结构补丁保留原范围及他人开关，本人开关默认开启', () => {
    expect(migratedRow).toEqual({ scope_type: 'by_users', view_others: 1, edit_others: 0, delete_others: 1, view_self: 1, edit_self: 1, delete_self: 1 });
  });

  it('保存回显、会话加载与 tokenVersion 一致；非法目标不修改配置', async () => {
    const before = await db.getRepository(User).findOneByOrFail({ id: 2 });
    await scopes.saveRows(2, [shared], 2);
    expect((await scopes.getPanelRows(2)).find(row => row.scopeKey === 'example-items')).toMatchObject(shared);
    expect((await scopes.loadForSession(2)).find(row => row.scopeKey === 'example-items')).toMatchObject(shared);
    expect((await db.getRepository(User).findOneByOrFail({ id: 2 })).tokenVersion).toBe(before.tokenVersion + 1);
    await expect(scopes.saveRows(2, [{ ...shared, targets: [999] }], 2)).rejects.toThrow('不存在的目标');
    expect((await scopes.loadForSession(2)).find(row => row.scopeKey === 'example-items')).toMatchObject(shared);
  });
  it('共同范围控制列表、筛选、详情及导出，含部门下级，拒绝范围外', async () => {
    expect((await service.list({}, actor())).list.map(row => row.id).sort()).toEqual([2, 7, 8]);
    expect((await service.distinctValues('title', actor())).sort()).toEqual(['事项2', '事项7', '事项8']);
    const exported = await service.exportExcel(actor());
    expect((await excelToData(exported.buffer, { title: ['标题'] })).map(row => row.title).sort()).toEqual(['事项2', '事项7', '事项8']);
    await expect(service.findOne(7, actor())).resolves.toMatchObject({ id: 7 });
    await expect(service.findOne(9, actor({ viewOthers: 1, editOthers: 1, deleteOthers: 1 }))).rejects.toThrow('记录不存在');
  });
  it('可看他人但仅能编辑本人、不能删除，打开删除他人后仍不能删除本人', async () => {
    await expect(service.update(2, { title: '可编辑' }, 2, actor())).resolves.toMatchObject({ title: '可编辑' });
    await expect(service.update(7, { title: '越权' }, 2, actor())).rejects.toThrow('没有编辑他人');
    await expect(service.lockedRead(db, 7, actor(), 'edit')).rejects.toThrow('没有编辑他人');
    await expect(service.remove(2, actor())).rejects.toThrow('没有删除本人');
    await expect(service.remove(7, actor())).rejects.toThrow('没有删除他人');
    await expect(service.remove(7, actor({ deleteOthers: 1 }))).resolves.toMatchObject({ success: true });
    await expect(service.remove(2, actor({ deleteOthers: 1 }))).rejects.toThrow('没有删除本人');
  });
  it.each(['viewSelf', 'editSelf', 'deleteSelf', 'viewOthers', 'editOthers', 'deleteOthers'] as const)('%s 可独立关闭且带锁路径不能绕过', async key => {
    const op = key.startsWith('view') ? 'view' : key.startsWith('edit') ? 'edit' : 'delete';
    const id = key.endsWith('Self') ? 2 : 7;
    const flags = { viewSelf: 1, editSelf: 1, deleteSelf: 1, viewOthers: 1, editOthers: 1, deleteOthers: 1, [key]: 0 };
    await expect(service.lockedRead(db, id, actor(flags), op)).rejects.toThrow('没有');
    await expect(service.lockedRead(db, id, actor({ ...flags, [key]: 1 }), op)).resolves.toMatchObject({ id });
  });
  it('详情关闭不改变列表范围，但详情、编辑及导出不能绕过；删除保持独立', async () => {
    const restricted = actor({ viewSelf: 0, viewOthers: 0, editSelf: 1, editOthers: 1, deleteSelf: 1 });
    expect((await service.list({}, restricted)).list).toHaveLength(3);
    await expect(service.findOne(2, restricted)).rejects.toThrow('没有查看本人');
    await expect(service.update(2, { title: '越权' }, 2, restricted)).rejects.toThrow('没有查看本人');
    await expect(service.update(7, { title: '越权' }, 2, restricted)).rejects.toThrow('没有查看他人');
    expect(await excelToData((await service.exportExcel(restricted)).buffer, { title: ['标题'] })).toEqual([]);
    const onlyOthers = await service.exportExcel(actor({ viewSelf: 0 }));
    expect((await excelToData(onlyOthers.buffer, { title: ['标题'] })).map(row => row.title).sort()).toEqual(['事项7', '事项8']);
    const onlySelf = await service.exportExcel(actor({ viewOthers: 0 }));
    expect(await excelToData(onlySelf.buffer, { title: ['标题'] })).toEqual([{ title: '事项2' }]);
    await expect(service.remove(2, restricted)).resolves.toMatchObject({ success: true });
  });
  it('表单未配置时仅本人；明确行独立生效；admin 保留例外', async () => {
    const global = { ...shared, scopeKey: '__global__', viewSelf: 0 };
    const inherited = { sub: 2, dataScopes: [global] };
    await expect(service.findOne(2, inherited)).resolves.toMatchObject({ id: 2 });
    await expect(service.findOne(7, inherited)).rejects.toThrow('记录不存在');
    await expect(service.findOne(2, { ...inherited, dataScopes: [global, { ...shared, viewSelf: 1 }] })).resolves.toMatchObject({ id: 2 });
    await expect(service.findOne(9, { ...inherited, roles: ['admin'] })).resolves.toMatchObject({ id: 9 });
  });
  it('旧请求未携带本人字段时保持默认开启', async () => {
    await scopes.saveRows(2, [{ scopeKey: 'example-items', scopeType: 'self' }], 2);
    expect((await scopes.loadForSession(2))[0]).toMatchObject({ viewSelf: 1, editSelf: 1, deleteSelf: 1 });
  });
});
