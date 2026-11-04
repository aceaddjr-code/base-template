import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { MustChangePasswordGuard } from './guards/must-change-password.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SystemLogService } from '../system/system-log.service';
import { JwtService } from '@nestjs/jwt';

/** 受保护端点样本：无任何豁免标记。 */
@Controller('samples')
class SampleController {
  @Get('protected') protected_() { return { ok: true }; }
}

describe('待改密门禁（真实守卫与元数据，规格 3.3）', () => {
  let app: import('@nestjs/common').INestApplication;
  let sessionUser: Record<string, unknown> | undefined;

  beforeAll(async () => {
    const authService = {
      getProfile: async () => ({ id: 1, mustChangePassword: true }),
      changeMyPassword: async () => ({ message: '密码已修改，请重新登录' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [SampleController, AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SystemLogService, useValue: { write: async () => undefined } },
        { provide: JwtService, useValue: { decode: () => ({ exp: Date.now() / 1000 + 3600 }), verify: () => null } },
        { provide: APP_GUARD, useClass: MustChangePasswordGuard },
      ],
    })
      // getProfile 自带真实 JwtAuthGuard；测试里 req.user 由中间件注入，守卫放行即可
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    // 模拟 JwtAuthGuard 的产物：req.user（含数据库读回的待改密标志）
    app.use((req: Record<string, unknown>, _res: unknown, next: () => void) => {
      if (sessionUser) req.user = sessionUser;
      next();
    });
    await app.init();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => { sessionUser = { sub: 1, username: 'alice', roles: ['user'], mustChangePassword: true }; });

  it('受限会话访问白名单外受保护接口：403 + PASSWORD_CHANGE_REQUIRED，不进入业务', async () => {
    const response = await request(app.getHttpServer()).get('/samples/protected');
    expect(response.status).toBe(403);
    // 统一 code/requestId 包装由全局异常过滤器补充（真实应用装配），此处只断言门禁语义
    expect(response.body).toMatchObject({ reason: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it('admin 的受限会话同样被拦截（门禁先于角色/操作权限）', async () => {
    sessionUser = { sub: 1, username: 'admin', roles: ['admin'], mustChangePassword: true };
    await request(app.getHttpServer()).get('/samples/protected').expect(403);
  });

  it('白名单端点放行：profile 与本人改密', async () => {
    await request(app.getHttpServer()).get('/auth/profile').expect(200);
    await request(app.getHttpServer()).patch('/auth/password').send({}).expect(200);
  });

  it('公共接口不经门禁；未标记待改密的正常会话不受影响', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(201);
    sessionUser = { sub: 1, username: 'alice', roles: ['user'], mustChangePassword: false };
    await request(app.getHttpServer()).get('/samples/protected').expect(200);
    sessionUser = undefined;
    await request(app.getHttpServer()).get('/samples/protected').expect(200);
  });
});
