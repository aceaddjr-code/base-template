import { createConnection } from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { PermissionExplanationService } from '../src/modules/auth/permission-explanation.service';
import { UserDataScopeService } from '../src/modules/user/user-data-scope.service';
import { User } from '../src/modules/user/user.entity';
import { UserRole } from '../src/modules/user/user-role.entity';
import { Role } from '../src/modules/role/role.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { Department } from '../src/modules/department/department.entity';
import { UserDataScope } from '../src/modules/user/user-data-scope.entity';
import { UserDataScopeTarget } from '../src/modules/user/user-data-scope-target.entity';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { EXPLAIN_REASONS } from '../src/modules/user/permission-explanation.contracts';

/**
 * 权限效果解释（第二批 02）：真实 MySQL 的区分性回归——部门范围必须经与实际列表
 * 同源的 SQL（含子树）判定。仅靠 assertCanOperateOn 的错误路径会放行子树外记录：
 * 本套件构造「目标开全部他人开关 + by_depts(部门A)」，
 * 子部门 A1 内记录应 allowed，部门 B（子树外）记录应 RECORD_NOT_FOUND。
 */
const suite = process.env.TEST_EXPLAIN_DATABASE ? describe : describe.skip;
suite('权限效果解释：隔离 MySQL 部门子树', () => {
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let source: DataSource;
  let created = false;
  const database = process.env.TEST_EXPLAIN_DATABASE!;
  let service: PermissionExplanationService;
  let TARGET_ID = 0;
  let inSubtreeRecord: number;
  let outSubtreeRecord: number;
  let selfRecord: number;
  let deletedRecord: number;

  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    admin = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
    const [old] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;

    source = new DataSource({
      type: 'mysql', host, port: Number(process.env.DB_PORT || 3306),
      username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database,
      entities: [User, UserRole, Role, Menu, Department, UserDataScope, UserDataScopeTarget, ExampleItem],
      synchronize: true,
    });
    await source.initialize();

    const depts = source.getRepository(Department);
    const hq = await depts.save({ name: '总部', code: 'hq', parentId: null, status: 1, sort: 1 });
    const deptA = await depts.save({ name: '部门A', code: 'a', parentId: hq.id, status: 1, sort: 1 });
    const deptA1 = await depts.save({ name: '子部门A1', code: 'a1', parentId: deptA.id, status: 1, sort: 1 });
    const deptB = await depts.save({ name: '部门B', code: 'b', parentId: hq.id, status: 1, sort: 2 });

    const roles = source.getRepository(Role);
    await roles.save({ id: 2, name: '普通用户', code: 'user', description: '', status: 1 });

    const users = source.getRepository(User);
    const target = await users.save({ username: 'explain-target', displayName: '解释目标', status: 1, tokenVersion: 1, deptId: deptA1.id, roleId: 2, password: 'x' });
    const peerA1 = await users.save({ username: 'peer-a1', displayName: '子部门同事', status: 1, tokenVersion: 1, deptId: deptA1.id, password: 'x' });
    const peerB = await users.save({ username: 'peer-b', displayName: '部门B同事', status: 1, tokenVersion: 1, deptId: deptB.id, password: 'x' });
    TARGET_ID = target.id;

    const menus = source.getRepository(Menu);
    for (const permission of ['example-items:view', 'example-items:update', 'example-items:delete', 'example-items:export']) {
      const button = await menus.save({ name: permission, parentId: null, path: null, permission, type: 'button', status: 1, sort: 1 });
      await source.query('INSERT INTO role_menus (role_id, menu_id) VALUES (2, ?)', [button.id]);
    }

    // 目标：by_depts(部门A)，六个开关全开——assertCanOperateOn 口径下任何他人记录都过
    const scope = await source.getRepository(UserDataScope).save({ userId: TARGET_ID, scopeKey: 'example-items', scopeType: 'by_depts', viewOthers: 1, editOthers: 1, deleteOthers: 1, viewSelf: 1, editSelf: 1, deleteSelf: 1, ownerId: TARGET_ID });
    await source.getRepository(UserDataScopeTarget).save({ userDataScopeId: scope.id, targetId: deptA.id, targetType: 'dept' });

    const items = source.getRepository(ExampleItem);
    inSubtreeRecord = (await items.save({ title: '子部门A1同事的单据', status: 'pending', version: 1, ownerId: peerA1.id, createdBy: peerA1.id })).id;
    outSubtreeRecord = (await items.save({ title: '部门B同事的单据', status: 'pending', version: 1, ownerId: peerB.id, createdBy: peerB.id })).id;
    selfRecord = (await items.save({ title: '目标本人的单据', status: 'pending', version: 1, ownerId: TARGET_ID, createdBy: TARGET_ID })).id;
    deletedRecord = (await items.save({ title: '已删除的单据', status: 'pending', version: 1, ownerId: peerA1.id, createdBy: peerA1.id })).id;
    await items.softDelete(deletedRecord);

    // 身份解析桩：角色/权限码口径与真实一致；dataScopes 来自真实配置表（loadForSession）
    const userDataScopes = new UserDataScopeService(
      source.getRepository(UserDataScope), source.getRepository(UserDataScopeTarget),
      source.getRepository(User), source.getRepository(Department),
    );
    const authService: any = {
      buildEffectiveIdentity: async (userId: number) => ({
        roles: ['user'], roleIds: [2],
        dataScopes: await userDataScopes.loadForSession(userId),
      }),
      getUserAccessCodes: async () => ['example-items:view', 'example-items:update', 'example-items:delete', 'example-items:export'],
    };
    const logService: any = { write: async () => undefined };
    service = new PermissionExplanationService(
      source.getRepository(User), source.getRepository(Department), source.getRepository(ExampleItem), authService, logService,
    );
  }, 120000);

  afterAll(async () => {
    await source?.destroy().catch(() => undefined);
    if (created) await admin.query(`DROP DATABASE \`${database}\``);
    await admin?.end();
  });

  const evaluationsOf = async (recordId: number) => {
    const response = await service.explain(TARGET_ID, 'example-items', { id: recordId }, { sub: 1, username: 'admin' });
    return Object.fromEntries((response.recordEvaluation ?? []).map((item) => [item.action, item]));
  };

  it('子树内他人记录：SQL 判定 allowed（assertCanOperateOn 同样会放行，两者一致）', async () => {
    const results = await evaluationsOf(inSubtreeRecord);
    for (const action of ['list', 'detail', 'update', 'delete', 'export'] as const) {
      expect(results[action].result).toBe('allowed');
    }
  });

  it('子树外他人记录：SQL 判定拒绝——仅靠 assertCanOperateOn 的错误路径会误放行', async () => {
    const results = await evaluationsOf(outSubtreeRecord);
    for (const action of ['list', 'detail', 'update', 'delete', 'export'] as const) {
      expect(results[action].result).toBe('denied');
      expect(results[action].reasonCodes).toEqual([EXPLAIN_REASONS.RECORD_NOT_FOUND]);
    }
  });

  it('本人记录与软删除记录按口径裁决；摘要包含版本与来源', async () => {
    const self = await evaluationsOf(selfRecord);
    expect(self.list.result).toBe('allowed');
    expect(self.detail.result).toBe('allowed');
    const deleted = await evaluationsOf(deletedRecord);
    expect(deleted.detail.reasonCodes).toEqual([EXPLAIN_REASONS.RECORD_NOT_FOUND]);

    const summary = await service.explain(TARGET_ID, 'example-items', null, { sub: 1, username: 'admin' });
    expect(summary.recordEvaluation).toBeNull();
    expect(summary.tokenVersion).toBe(1);
    expect(summary.dataScope.scopeType).toBe('by_depts');
    expect(summary.dataScope.targetDepts).toEqual([{ id: expect.any(Number), label: '部门A' }]);
    const view = summary.operationPermissions.find((item) => item.action === 'detail')!;
    expect(view.effective).toBe(true);
    expect(view.sources).toEqual([expect.objectContaining({ roleCode: 'user', roleEnabled: true })]);
  });
});
