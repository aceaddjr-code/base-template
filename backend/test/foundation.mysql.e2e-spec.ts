import 'reflect-metadata';
import { BeforeSoftRemove, Column, DataSource, Entity } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BaseEntity } from '../src/common/entities/base.entity';
import { CrudBaseService } from '../src/common/services/crud-base.service';
import { Notification } from '../src/modules/system/entities/notification.entity';
import { NotificationService } from '../src/modules/system/notification.service';
import { BackupService } from '../src/modules/system/backup.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy, JwtPayload } from '../src/modules/auth/jwt.strategy';
import { User } from '../src/modules/user/user.entity';
import { Role } from '../src/modules/role/role.entity';
import { Menu } from '../src/modules/menu/menu.entity';
import { Department } from '../src/modules/department/department.entity';
import { UserRole } from '../src/modules/user/user-role.entity';
import { UserDataScope } from '../src/modules/user/user-data-scope.entity';
import { UserDataScopeTarget } from '../src/modules/user/user-data-scope-target.entity';
import { ExampleItem } from '../src/modules/example/example-item.entity';
import { ExampleService } from '../src/modules/example/example.service';
import { SystemLog } from '../src/modules/system/entities/system-log.entity';
import { SystemLogService } from '../src/modules/system/system-log.service';
import { excelToData } from '../src/common/utils/excel-helper';

@Entity('foundation_test_parents')
class Parent extends BaseEntity {
  @Column({ type: 'varchar', length: 100 }) title: string;
  @Column({ name: 'owner_id', type: 'int', nullable: true }) ownerId: number | null;
}
@Entity('foundation_test_children')
class Child extends BaseEntity {
  @Column({ name: 'source_id', type: 'int' }) sourceId: number;
  @Column({ name: 'source_type', type: 'varchar', length: 20 }) sourceType: string;
  @Column({ type: 'boolean', default: false }) failDelete: boolean;
  @BeforeSoftRemove() refuse() { if (this.failDelete) throw new Error('child-delete-failure'); }
}

/** 显式指定本轮临时库名才启用；绝不自动复用 .env 的业务库。 */
const suite = process.env.TEST_MYSQL_DATABASE ? describe : describe.skip;
suite('独立 MySQL：删除回滚、通知分页和原生备份', () => {
  let data: DataSource;
  let admin: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  let backupDir: string;
  const database = process.env.TEST_MYSQL_DATABASE!;
  const originalDatabase = process.env.DB_DATABASE;
  beforeAll(async () => {
    if (!/^base_template_test_\d+$/.test(database) || database === originalDatabase) throw new Error('拒绝在非独立测试库执行');
    const connection = { host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD };
    admin = await createConnection(connection);
    const [existing] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((existing as unknown[]).length) throw new Error('测试库已经存在，拒绝覆盖');
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    created = true;
    data = new DataSource({ type: 'mysql', ...connection, username: connection.user, database, entities: [Parent, Child, Notification, User, Role, Menu, Department, UserRole, UserDataScope, UserDataScopeTarget, ExampleItem, SystemLog], synchronize: true });
    await data.initialize();
    process.env.DB_DATABASE = database;
    backupDir = await mkdtemp(join(tmpdir(), 'base-foundation-mysql-'));
  }, 30000);
  afterAll(async () => {
    if (originalDatabase === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = originalDatabase;
    if (data?.isInitialized) await data.destroy();
    if (admin) {
      if (created && /^base_template_test_\d+$/.test(database) && database !== originalDatabase) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
    if (backupDir && dirname(backupDir) === tmpdir()) await rm(backupDir, { recursive: true, force: true });
  });

  it('子表监听器失败时主表和已删除子表整体回滚；成功只删对应来源', async () => {
    const parents = data.getRepository(Parent), children = data.getRepository(Child);
    const parent = await parents.save({ title: '真实事务', ownerId: 7 });
    const child = await children.save({ sourceId: parent.id, sourceType: 'checked', failDelete: true });
    const other = await children.save({ sourceId: parent.id, sourceType: 'other' });
    const service = new CrudBaseService(parents, { rows: { repo: children, sourceKey: 'source_id', sourceType: 'checked' } }, { dataScoped: false });
    await expect(service.remove(parent.id)).rejects.toThrow('child-delete-failure');
    expect(await parents.countBy({ id: parent.id })).toBe(1);
    expect(await children.countBy({ id: child.id })).toBe(1);
    await children.update(child.id, { failDelete: false });
    await expect(service.remove(parent.id)).resolves.toEqual({ success: true });
    expect(await parents.countBy({ id: parent.id })).toBe(0);
    expect(await children.countBy({ id: child.id })).toBe(0);
    expect(await children.countBy({ id: other.id })).toBe(1);
  });

  it('未读跨页 total 正确，其他用户数据不可进入结果，标读后回读一致', async () => {
    const repo = data.getRepository(Notification);
    await repo.save(Array.from({ length: 25 }, (_, i) => ({ userId: 7, title: `通知${i}`, type: 'test', readAt: i < 2 ? new Date() : null })));
    await repo.save({ userId: 8, title: '其他用户', type: 'test' });
    const service = new NotificationService(repo);
    const page = await service.findMine(7, 3, 10, 'unread');
    expect(page.total).toBe(23);
    expect(page.list).toHaveLength(3);
    expect(page.list.every(row => row.userId === 7 && row.readAt === null)).toBe(true);
    await service.markRead(7, page.list[0].id);
    expect((await service.findMine(7, 3, 10, 'unread')).total).toBe(22);
    await service.markAllRead(7);
    expect(await service.unreadCount(7)).toBe(0);
    expect(await service.unreadCount(8)).toBe(1);
  });

  it('原生执行器生成真实 gzip SQL 文件，事件循环保持响应；未进行恢复演练', async () => {
    const service = new BackupService(new ConfigService({ BACKUP_DIR: backupDir, BACKUP_SCRIPT: resolve(process.cwd(), '../scripts/backup.mjs') }));
    const file = await service.runBackup();
    expect(file.filename.startsWith(database + '-')).toBe(true);
    const sql = gunzipSync(await readFile(join(backupDir, file.filename))).toString('utf8');
    expect(sql).toContain('foundation_test_parents');
    expect(sql).toContain('CREATE TABLE');
    expect(service.status().status).toBe('succeeded');
  }, 30000);

  it('三位自助改密真实落库，原签名 JWT 的会话版本失效，新密码可重新签发', async () => {
    const users = data.getRepository(User);
    const user = await users.save({ username: 'password-check', password: await bcrypt.hash('abc', 10), status: 1, tokenVersion: 1 });
    const secret = 'test-only-secret-'.repeat(4);
    const jwt = new JwtService({ secret });
    const auth = new AuthService(jwt, users, data.getRepository(Role), data.getRepository(Menu), data.getRepository(UserRole), data.getRepository(UserDataScope), data.getRepository(UserDataScopeTarget));
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: secret }), users);
    const signed = await auth.login(user.username, 'abc');
    const oldPayload = jwt.verify<JwtPayload>(signed.token);
    await expect(strategy.validate(oldPayload)).resolves.toMatchObject({ sub: user.id, tokenVersion: 1 });
    await auth.changeMyPassword(oldPayload, { oldPassword: 'abc', newPassword: 'def', confirmPassword: 'def' });
    const saved = await users.findOneOrFail({ where: { id: user.id }, select: { password: true, tokenVersion: true } });
    expect(saved.tokenVersion).toBe(2);
    expect(await bcrypt.compare('def', saved.password)).toBe(true);
    await expect(strategy.validate(oldPayload)).rejects.toThrow('Token 已失效');
    await expect(auth.login(user.username, 'abc')).rejects.toThrow('账号或密码错误');
    const renewed = await auth.login(user.username, 'def');
    await expect(strategy.validate(jwt.verify(renewed.token))).resolves.toMatchObject({ sub: user.id, tokenVersion: 2 });
  });
  it('多选与日期在真实列表、导出和日志 total 中同口径，结束日包含毫秒且拒绝反向日期', async () => {
    const repo = data.getRepository(ExampleItem);
    const entries = await repo.save([
      { title: '筛选目标甲', status: 'pending', ownerId: 1 },
      { title: '筛选目标乙', status: 'doing', ownerId: 1 },
      { title: '筛选目标丙', status: 'done', ownerId: 1 },
    ]);
    for (const entry of entries) await repo.update(entry.id, { updatedAt: new Date(2026, 9, 21, 23, 59, 59, 999) });
    const outside = await repo.save({ title: '筛选目标次日', status: 'pending', ownerId: 1 });
    await repo.update(outside.id, { updatedAt: new Date(2026, 9, 22, 0, 0) });
    const service = new ExampleService(repo);
    const query = { keyword: '筛选目标', filters: { status: 'pending,doing', updatedAtFrom: '2026-10-21', updatedAtTo: '2026-10-21' } };
    const user = { sub: 1, roles: ['admin'] };
    const result = await service.list(query, user);
    expect(result.total).toBe(2);
    expect(result.list.map(row => row.title).sort()).toEqual(['筛选目标乙', '筛选目标甲']);
    const exported = await service.exportExcel(user, { ...query, cols: ['title', 'status'] });
    expect((await excelToData(exported.buffer, { title: ['标题'], status: ['状态'] })).map(row => row.title).sort()).toEqual(result.list.map(row => row.title).sort());
    await expect(service.list({ filters: { updatedAtFrom: '2026-10-22', updatedAtTo: '2026-10-21' } }, user)).rejects.toThrow('开始日期不能晚于结束日期');
    const logs = data.getRepository(SystemLog);
    await logs.save([
      { action: 'create', entityType: 'range-test', createdAt: new Date(2026, 9, 21, 23, 59, 59, 999) },
      { action: 'update', entityType: 'range-test', createdAt: new Date(2026, 9, 21, 12) },
      { action: 'delete', entityType: 'range-test', createdAt: new Date(2026, 9, 21, 12) },
      { action: 'create', entityType: 'range-test', createdAt: new Date(2026, 9, 22, 0) },
    ]);
    const audit = new SystemLogService(logs, new ConfigService());
    const page = await audit.findAll({ action: 'create,update', entityType: 'range-test', dateFrom: '2026-10-21', dateTo: '2026-10-21', pageSize: 1 });
    expect(page.total).toBe(2); expect(page.list).toHaveLength(1);
  });
});
