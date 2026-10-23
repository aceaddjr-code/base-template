import { Body, Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../src/app.setup';
import { NotificationController } from '../src/modules/system/notification.controller';
import { NotificationService } from '../src/modules/system/notification.service';
import { FrontendErrorController } from '../src/modules/monitor/frontend-error.controller';
import { requestContext } from '../src/common/utils/request-context';

@Controller('test-errors')
class ErrorController {
  @Get() error() { throw new Error('private-internal-error'); }
  @Post() async context(@Body() _body: unknown) {
    await new Promise(done => setTimeout(done, 5));
    return { requestId: requestContext.getStore()?.requestId };
  }
}

describe('通知查询、请求追踪和错误上报 HTTP 协议', () => {
  let app: NestExpressApplication;
  const service = { findMine: jest.fn().mockResolvedValue({ list: [], total: 23, page: 2, pageSize: 10 }) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationController, FrontendErrorController, ErrorController],
      providers: [{ provide: NotificationService, useValue: service }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    app.use((req, _res, next) => { req.user = { sub: 7 }; next(); });
    configureApplication(app, new ConfigService());
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('未读条件、分页与当前身份传递服务端，非法查询在读取前拒绝', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/system/notifications?page=2&pageSize=10&readStatus=unread').expect(200);
    expect(service.findMine).toHaveBeenLastCalledWith(7, 2, 10, 'unread');
    expect(response.body.data.total).toBe(23);
    service.findMine.mockClear();
    for (const query of ['page=-1', 'page=1oops', 'pageSize=101', 'readStatus=unknown', 'userId=88']) {
      await request(app.getHttpServer()).get('/api/v1/system/notifications?' + query).expect(400);
    }
    expect(service.findMine).not.toHaveBeenCalled();
  });

  it('错误响应头、响应体请求号一致，内部消息不泄露', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/test-errors').set('X-Request-ID', 'test-request-123').expect(500);
    expect(response.body).toEqual({ code: 500, message: '服务器内部错误', data: null, requestId: 'test-request-123' });
    expect(response.headers['x-request-id']).toBe('test-request-123');
  });

  it('非法/过长请求号重新生成，并发异步调用不会串上下文', async () => {
    const generated = await request(app.getHttpServer()).post('/api/v1/test-errors').set('X-Request-ID', 'x'.repeat(100)).send({}).expect(201);
    expect(generated.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    const responses = await Promise.all(['parallel-a', 'parallel-b'].map(id => request(app.getHttpServer()).post('/api/v1/test-errors').set('X-Request-ID', id).send({})));
    expect(responses.map(response => response.body.data.requestId)).toEqual(['parallel-a', 'parallel-b']);
  });

  it('JSON 解析失败也能获取请求号，跨来源可读取请求号头', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/test-errors').set('Content-Type', 'application/json').send('{invalid').expect(400);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.headers['access-control-expose-headers']).toContain('X-Request-ID');
  });

  it('上报逐项校验，最多 20 项，拒绝超长和伪造字段', async () => {
    const endpoint = '/api/v1/monitor/frontend-error';
    await request(app.getHttpServer()).post(endpoint).send({ events: [{ type: 'network-error', requestId: 'original-error-id' }] }).expect(201);
    for (const events of [Array(21).fill({ type: 'error' }), [{ type: 'error', stack: 'x'.repeat(5001) }], [{ type: 'error', unexpected: 'value' }], [null]]) {
      await request(app.getHttpServer()).post(endpoint).send({ events }).expect(400);
    }
  });
});
