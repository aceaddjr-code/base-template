import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { User } from './user.entity';
import { UserRole } from './user-role.entity';
import { UserDataScope } from './user-data-scope.entity';
import { UserDataScopeTarget } from './user-data-scope-target.entity';
import { Role } from '../role/role.entity';
import { Department } from '../department/department.entity';
import { SystemLogService } from '../system/system-log.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */

describe('UserService 组织汇报关系', () => {
  let service: UserService;
  let userRepo: any;
  let roleRepo: any;
  let deptRepo: any;
  let userRoleRepo: any;
  let logService: any;

  // 1 张三 无上级；2 李四 无上级；3 王五 禁用；4 赵六 leader=2（链 4→2）
  const USERS = [
    { id: 1, username: 'zhangsan', displayName: '张三', status: 1, deptId: 10, roleId: 1, leaderId: null, tokenVersion: 1 },
    { id: 2, username: 'lisi', displayName: '李四', status: 1, deptId: 10, roleId: 1, leaderId: null, tokenVersion: 1 },
    { id: 3, username: 'wangwu', displayName: '王五', status: 0, deptId: 10, roleId: 1, leaderId: null, tokenVersion: 1 },
    { id: 4, username: 'zhaoliu', displayName: '赵六', status: 1, deptId: 10, roleId: 1, leaderId: 2, tokenVersion: 1 },
  ];

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }: any) => USERS.find((u) => u.id === where?.id) ?? null),
      update: jest.fn(async () => ({})),
      increment: jest.fn(async () => ({})),
      save: jest.fn(async (e: any) => ({ ...e, id: e.id ?? 99 })),
      manager: {
        transaction: jest.fn(async (fn: any) =>
          fn({
            delete: jest.fn(async () => ({})),
            save: jest.fn(async (_entity: any, data: any) => ({ ...data, id:data.id ?? 99 })),
            update: (_entity: any, id:number, patch:any) => userRepo.update(id,patch),
            increment: (_entity:any, criteria:any, field:string, value:number) => userRepo.increment(criteria,field,value),
            createQueryBuilder: () => ({
              update: () => ({ set: () => ({ where: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
            }),
          }),
        ),
      },
    };
    roleRepo = { findOne: jest.fn().mockResolvedValue({ id: 1, code: 'admin' }) };
    deptRepo = { findOne: jest.fn().mockResolvedValue({ id: 10, code: 'dev' }) };
    userRoleRepo = { find: jest.fn().mockResolvedValue([]), delete: jest.fn(async () => ({})), save: jest.fn(async () => ({})) };
    logService = { write: jest.fn(async () => undefined), writeInTransaction: jest.fn(async () => undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(Department), useValue: deptRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(UserDataScope), useValue: {} },
        { provide: getRepositoryToken(UserDataScopeTarget), useValue: {} },
        { provide: SystemLogService, useValue: logService },
      ],
    }).compile();
    service = module.get(UserService);
  });

  const ADMIN = { sub: 0, roles: ['admin'] } as any;

  it('S5 update：设置 leaderId（启用用户）→ 白名单字段落库', async () => {
    await service.update(1, { leaderId: 2 }, ADMIN);
    expect(userRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ leaderId: 2 }));
  });

  it('S5 update：清空 leaderId（传 null）→ 允许', async () => {
    await service.update(2, { leaderId: null }, ADMIN);
    expect(userRepo.update).toHaveBeenCalledWith(2, expect.objectContaining({ leaderId: null }));
  });

  it('S5 update：指向自己 → 400', async () => {
    await expect(service.update(1, { leaderId: 1 }, ADMIN)).rejects.toThrow(BadRequestException);
  });

  it('S5 update：指向禁用用户 → 400', async () => {
    await expect(service.update(1, { leaderId: 3 }, ADMIN)).rejects.toThrow(BadRequestException);
  });

  it('S5 update：防环（把李四的上级设为赵六，而赵六链上已含李四）→ 400', async () => {
    // 赵六（4）→ 李四（2）。把李四（2）上级设为赵六（4）→ 环
    await expect(service.update(2, { leaderId: 4 }, ADMIN)).rejects.toThrow(BadRequestException);
  });

  it('S5 create：本地账号可设置 leaderId（启用用户），密码由系统生成临时密码', async () => {
    userRepo.findOne.mockImplementation(async ({ where }: any) => {
      if (where?.username === 'newuser') return null; // 工号不存在 → 放行创建
      if (where?.id === 99) return { id: 99, username: 'newuser', displayName: '新人', status: 1, deptId: 10, roleId: 1, leaderId: 2, tokenVersion: 1 };
      return USERS.find((u) => u.id === where?.id) ?? null;
    });
    const u: any = await service.create(
      { loginid: 'newuser', displayName: '新人', roleId: 1, leaderId: 2 },
      ADMIN,
    );
    expect(u.leaderId).toBe(2);
    // 一次性凭据仅在响应返回；落库的是待改密标记与到期时间，不是明文
    expect(u.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(typeof u.expiresAt).toBe('string');
  });

  it('账号安全：create 拒绝旧 password 入参', async () => {
    await expect(service.create({ loginid: 'x', password: 'pass12345', displayName: '新人' } as any, ADMIN))
      .rejects.toThrow(BadRequestException);
  });

  it('账号安全：update 拒绝非空 password，指向重置动作', async () => {
    await expect(service.update(1, { password: 'whatever123' } as any, ADMIN))
      .rejects.toThrow('重置密码');
  });

  it('账号安全：resetPassword 校验目标与本人，成功返回一次性凭据并同事务审计', async () => {
    await expect(service.resetPassword(1, { sub: 1, username: 'zhangsan' } as any))
      .rejects.toThrow(ForbiddenException);
    await expect(service.resetPassword(3, ADMIN)).rejects.toThrow(BadRequestException); // 禁用
    await expect(service.resetPassword(999, ADMIN)).rejects.toThrow(NotFoundException);
    const result = await service.resetPassword(1, ADMIN, { ip: '127.0.0.1' });
    expect(result.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(result.expiresAt).toBeTruthy();
    expect(logService.writeInTransaction).toHaveBeenCalledTimes(1);
    const entry = logService.writeInTransaction.mock.calls[0][1];
    expect(entry).toMatchObject({ userId: 0, entityType: 'users', entityId: 1, ip: '127.0.0.1' });
    expect(entry.detail).toContain('"event":"password_reset"');
  });

  it('账号安全：resetPassword 允许 recovery-cli 显式自恢复', async () => {
    const result = await service.resetPassword(1, { sub: 1, username: 'zhangsan' } as any, { via: 'recovery-cli', allowSelf: true });
    expect(result.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(logService.writeInTransaction.mock.calls[0][1].detail).toContain('"via":"recovery-cli"');
  });
});

describe('UserService 列表筛选（F01/F04）', () => {
  function buildService() {
    const clauses: Array<{ sql: string; params: Record<string, unknown> }> = [];
    const qb: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn((sql: string, params: Record<string, unknown>) => {
        clauses.push({ sql, params });
        return qb;
      }),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(async () => ({})),
      save: jest.fn(async (e: any) => ({ ...e, id: 1 })),
    };
    const moduleRef: TestingModule = Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(Role), useValue: {} },
        { provide: getRepositoryToken(Department), useValue: { query: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(UserRole), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(UserDataScope), useValue: {} },
        { provide: getRepositoryToken(UserDataScopeTarget), useValue: {} },
        { provide: SystemLogService, useValue: { write: jest.fn(), writeInTransaction: jest.fn() } },
      ],
    }) as any;
    return { moduleRef, clauses };
  }

  it('状态多选与创建时间区间下推为数据库条件', async () => {
    const { moduleRef, clauses } = buildService();
    const service = await moduleRef.compile().then((m) => m.get(UserService));
    await service.findAll(1, 10, '张', undefined, [1, 0], { from: '2026-10-01 00:00:00', before: '2026-11-01 00:00:00' });
    const sqls = clauses.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('user.status IN');
    expect(sqls).toContain('user.created_at >=');
    expect(sqls).toContain('user.created_at <');
    const status = clauses.find((c) => c.sql.includes('status'));
    expect(status?.params).toEqual({ statuses: [1, 0] });
  });

  it('未传筛选时不追加状态与时间条件', async () => {
    const { moduleRef, clauses } = buildService();
    const service = await moduleRef.compile().then((m) => m.get(UserService));
    await service.findAll(1, 10);
    expect(clauses.some((c) => c.sql.includes('status IN'))).toBe(false);
    expect(clauses.some((c) => c.sql.includes('created_at'))).toBe(false);
  });
});
