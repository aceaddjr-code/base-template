import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { UserController } from '../src/modules/user/user.controller';
import { UserService } from '../src/modules/user/user.service';
import { UserDataScopeService } from '../src/modules/user/user-data-scope.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PermissionGuard } from '../src/modules/auth/guards/permission.guard';
import { PermissionExplanationService } from '../src/modules/auth/permission-explanation.service';

/** 只验证真实守卫元数据：类级 @Roles('admin') 下，simple 简表对普通登录用户放开、完整列表仍限管理员。 */
describe('用户简表登录即可访问（RolesGuard 覆盖）', () => {
  let app: NestExpressApplication;
  const userService = { findAllSimple: jest.fn().mockResolvedValue([{ id: 2, username: '000940', displayName: '普通用户', deptId: 1, deptName: '默认部门' }]), findAll: jest.fn().mockResolvedValue({ list: [], total: 0 }) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: UserDataScopeService, useValue: {} },
        { provide: PermissionExplanationService, useValue: {} },
        { provide: AuthService, useValue: { getUserAccessCodes: async () => [] } },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    // 模拟已登录的普通用户（非 admin 角色），JWT 守卫不参与本验证
    app.use((req: any, _res: any, next: () => void) => { req.user = { sub: 9, roleCode: 'user' }; next(); });
    configureApplication(app, new ConfigService());
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  it('普通登录用户可读 /users/simple（单据负责人候选与姓名解析依赖）', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/users/simple').expect(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(userService.findAllSimple).toHaveBeenCalled();
  });

  it('完整用户列表仍限管理员：普通用户 403', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(403);
    expect(userService.findAll).not.toHaveBeenCalled();
  });
});
