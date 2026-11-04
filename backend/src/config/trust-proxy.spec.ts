import { Controller, Get, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureApplication } from '../app.setup';

/**
 * 登录联合限流的 IP 取值依据 req.ip（任务 02 验收：伪造转发头不能伪造可信客户端 IP）。
 * 本规格直接走 configureApplication 的真实装配：TRUST_PROXY_HOPS 决定 express 的
 * trust proxy 语义——直连（0）不采信任何 X-Forwarded-For，指定一跳代理（1）才采信。
 */
@Controller('probe')
class ProbeController {
  @Get() capture(@Req() req: { ip?: string }) { return { ip: req.ip }; }
}

async function buildApp(hops: string) {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApplication(app, new ConfigService({ TRUST_PROXY_HOPS: hops, API_DOCS_ENABLED: 'false' }));
  await app.init();
  return app;
}

describe('可信客户端 IP 提取（TRUST_PROXY_HOPS）', () => {
  it('直连模式（0）：伪造 X-Forwarded-For 不能改变限流使用的 req.ip', async () => {
    const app = await buildApp('0');
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '203.0.113.99');
      expect(response.status).toBe(200);
      expect(['127.0.0.1', '::ffff:127.0.0.1', '::1']).toContain(response.body.data.ip);
    } finally { await app.close(); }
  });

  it('指定一跳代理（1）：才采信转发头，客户端取直连外第一跳，更左条目不采信', async () => {
    const app = await buildApp('1');
    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '203.0.113.99');
      expect(response.body.data.ip).toBe('203.0.113.99');
      // 客户端自带的伪造前缀不能顶替真实来源：只信最靠近服务的一跳，
      // 更左侧条目（203.0.113.99）是客户端可任意书写的内容。
      const spoofed = await request(app.getHttpServer())
        .get('/api/v1/probe')
        .set('X-Forwarded-For', '203.0.113.99, 198.51.100.7');
      expect(spoofed.body.data.ip).toBe('198.51.100.7');
    } finally { await app.close(); }
  });
});
