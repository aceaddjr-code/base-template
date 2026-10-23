import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { HealthController } from '../src/modules/monitor/health.controller';
import { HealthService } from '../src/modules/monitor/health.service';
import { configureApplication } from '../src/app.setup';

describe('健康接口 HTTP 协议（无数据库、无种子副作用）', () => {
  let app: NestExpressApplication;
  const query = jest.fn().mockResolvedValue([{ value:1 }]);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers:[AppController, HealthController],
      providers:[HealthService, { provide:DataSource, useValue:{ query } }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser:false });
    configureApplication(app, new ConfigService({ CORS_ORIGIN:'http://localhost:5174' }));
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('根接口返回当前健康状态和统一响应格式', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/').expect(200);
    expect(response.body).toEqual({ code:200, message:'success', data:{ status:'ok' } });
  });

  it('健康详情使用注入的查询接口', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body.data).toMatchObject({ status:'healthy', database:'connected' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('存活探针不触发数据库查询，就绪探针按同一查询判定', async () => {
    query.mockClear();
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(query).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('数据库查询失败时就绪探针返回 503，聚合视图仍为 200 degraded', async () => {
    query.mockRejectedValueOnce(new Error('connection refused')).mockRejectedValueOnce(new Error('connection refused'));
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body.data).toMatchObject({ status:'degraded', database:'disconnected' });
  });
});
