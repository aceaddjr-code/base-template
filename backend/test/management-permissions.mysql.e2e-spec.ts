import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANAGEMENT_PERMISSION_CODES } from '../src/modules/auth/seed.service';

const suite = process.env.TEST_PERMISSION_DATABASE ? describe : describe.skip;
suite('管理权限补丁：隔离 MySQL', () => {
  let connection: Awaited<ReturnType<typeof createConnection>>;
  let created = false;
  const database = process.env.TEST_PERMISSION_DATABASE!;
  // 权限节点补丁按文件名顺序执行；清单以 MANAGEMENT_PERMISSION_CODES 为准交叉核对。
  const patches = ['20261031-management-permissions.sql', '20261104-account-security.sql']
    .map((file) => readFileSync(resolve('..', 'docs/sql', file), 'utf8'));
  beforeAll(async () => {
    const host = process.env.DB_HOST || 'localhost';
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw Error('只允许本机隔离 MySQL');
    if (!/^base_template_test_\d+$/.test(database) || database === process.env.DB_DATABASE) throw Error('拒绝非隔离库');
    connection = await createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, multipleStatements: true });
    const [old] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
    if ((old as any[]).length) throw Error('隔离库已存在，拒绝覆盖');
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`); created = true;
    await connection.changeUser({ database });
    await connection.query(`
      CREATE TABLE menus (id int AUTO_INCREMENT PRIMARY KEY, parent_id int NULL, name varchar(50), path varchar(200) NULL,
        permission varchar(100) NULL, type varchar(20) DEFAULT 'menu', sort int DEFAULT 0, status tinyint DEFAULT 1, deleted_at datetime NULL);
      CREATE TABLE roles (id int PRIMARY KEY, code varchar(50), status tinyint DEFAULT 1, deleted_at datetime NULL);
      CREATE TABLE role_menus (role_id int, menu_id int, PRIMARY KEY(role_id, menu_id));
      CREATE TABLE users (id int PRIMARY KEY, role_id int, token_version int DEFAULT 1, deleted_at datetime NULL);
      CREATE TABLE user_roles (user_id int, role_id int, deleted_at datetime NULL);
    `);
  });
  beforeEach(async () => {
    await connection.query(`DELETE FROM role_menus; DELETE FROM user_roles; DELETE FROM users; DELETE FROM roles; DELETE FROM menus;
      INSERT INTO menus (id, name, path) VALUES (1, '系统管理', '/system');
      INSERT INTO roles (id, code) VALUES (1, 'admin'), (2, 'user');
      INSERT INTO users (id, role_id) VALUES (1, 1), (2, 2), (3, 2);
      INSERT INTO user_roles (user_id, role_id) VALUES (3, 1);
    `);
  });
  afterAll(async () => {
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection?.end();
  });

  it('补齐种子声明的全部管理权限并挂到对应页面，只授予 admin；重复执行无重复节点或授权', async () => {
    for (const sql of patches) { await connection.query(sql); await connection.query(sql); }
    const [buttons] = await connection.query('SELECT b.permission, p.path FROM menus b JOIN menus p ON p.id = b.parent_id WHERE b.type = ?', ['button']);
    expect(buttons).toHaveLength(MANAGEMENT_PERMISSION_CODES.length);
    expect((buttons as any[]).map(row => row.permission).sort()).toEqual([...MANAGEMENT_PERMISSION_CODES].sort());
    for (const row of buttons as any[]) {
      const page = row.permission.startsWith('dicts:') ? 'dict' : row.permission.startsWith('system-logs:') ? 'logs' : row.permission.split(':')[0];
      expect(row.path).toBe(`/system/${page}`);
    }
    const [grants] = await connection.query('SELECT role_id FROM role_menus');
    expect(grants).toHaveLength(MANAGEMENT_PERMISSION_CODES.length);
    expect((grants as any[]).every(row => row.role_id === 1)).toBe(true);
    // 两份补丁各执行两次：admin 用户每次执行各递增一次版本（1 + 2×2）；普通用户不变。
    const [users] = await connection.query('SELECT id, token_version FROM users ORDER BY id');
    expect(users).toEqual([{ id: 1, token_version: 5 }, { id: 2, token_version: 1 }, { id: 3, token_version: 5 }]);
  });

  it('保留已有停用、软删除权限与普通角色自定义授权，不覆盖或复活', async () => {
    await connection.query(`INSERT INTO menus (id, parent_id, name, path) VALUES (20, 1, '自定义公告页面', '/system/announcements');
      INSERT INTO menus (id, parent_id, name, type, permission, status, deleted_at) VALUES
        (21, 20, '停用查看', 'button', 'announcements:view', 0, NULL),
        (22, 20, '旧删除', 'button', 'announcements:delete', 1, '2026-01-01');
      INSERT INTO role_menus VALUES (2, 21);
    `);
    await connection.query(patches.join('\n'));
    const [existing] = await connection.query<any[]>('SELECT id, name, status, deleted_at FROM menus WHERE id IN (20, 21, 22) ORDER BY id');
    expect(existing).toHaveLength(3);
    expect(existing[0].name).toBe('自定义公告页面');
    expect(existing[1]).toMatchObject({ id: 21, name: '停用查看', status: 0 });
    expect(existing[2].deleted_at).not.toBeNull();
    const [duplicates] = await connection.query("SELECT permission, COUNT(*) AS n FROM menus WHERE permission IS NOT NULL GROUP BY permission HAVING COUNT(*) > 1");
    expect(duplicates).toHaveLength(0);
    const [grants] = await connection.query('SELECT menu_id FROM role_menus WHERE role_id = 2');
    expect(grants).toEqual([{ menu_id: 21 }]);
  });
});
