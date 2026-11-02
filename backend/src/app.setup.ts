import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validationException } from './common/utils/validation-errors';

/** 启动和 HTTP 测试使用相同的协议、验证和错误处理。 */
export function configureApplication(app: NestExpressApplication, config: ConfigService) {
  // 与附件上传客户端保持一致，允许慢网接收 500MB multipart 请求。
  app.getHttpServer().requestTimeout = 30 * 60 * 1000;
  const docsEnabled = config.get<string>('API_DOCS_ENABLED') === 'true';
  // Swagger UI 依赖内联脚本/样式；文档仅在受控环境开启，此时放宽 CSP，生产（文档关闭）保持默认
  app.use(helmet({ contentSecurityPolicy: !docsEnabled }));
  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));
  app.enableCors({
    origin:config.get<string>('CORS_ORIGIN', 'http://localhost:5174').split(',').map(value => value.trim()),
    credentials:true,
    exposedHeaders: ['X-Request-ID'],
  });
  app.use(cookieParser());
  const limit = config.get<string>('BODY_LIMIT', '1mb');
  app.use(express.json({ limit }));
  app.use(express.urlencoded({ extended:true, limit }));
  app.set('query parser', 'extended');
  const hops = Number(config.get<string>('TRUST_PROXY_HOPS', '0'));
  if (!Number.isInteger(hops) || hops < 0) throw new Error('TRUST_PROXY_HOPS 必须为非负整数');
  app.set('trust proxy', hops);
  app.useGlobalPipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true, validationError: { target: false, value: false }, exceptionFactory: validationException }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api/v1');
  setupApiDocs(app, config);
}

/**
 * F29 OpenAPI 文档：默认仅 development 开启（API_DOCS_ENABLED 可显式覆盖）。
 * 描述文件由 DTO 推导（nest-cli 编译插件），声明本项目响应/错误/分页/Cookie 认证约定；
 * 不能替代服务端运行时校验与权限校验。
 */
function setupApiDocs(app: NestExpressApplication, config: ConfigService) {
  if (config.get<string>('API_DOCS_ENABLED') !== 'true') return
  let version = '1.0.0'
  try { version = String(JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version) || version } catch { /* 版本回退默认值 */ }
  const docConfig = new DocumentBuilder()
    .setTitle('BaseSuite平台 API')
    .setVersion(version)
    .setDescription([
      '内部管理系统的接口文档。接口统一前缀 `/api/v1`。',
      '',
      '**响应约定**：全部接口返回统一包装 `{ code, message, data, requestId }`；成功 code=200，data 为业务数据。',
      '**错误约定**：失败时 data 为空；message 为用户可读文案；字段级校验错误（400）另附 `fieldErrors: [{ path, code, message }]`，嵌套路径形如 `rows.0.title`。',
      '**分页约定**：列表接口查询参数 `page`、`pageSize`（默认 1、10），返回 `{ list, total, page, pageSize }`。',
      '**认证**：登录成功后通过 httpOnly Cookie `access_token`（本页 Authorize 按钮可模拟）；会话失效或权限不足分别返回 401/403。写操作受 CSRF 防护：Content-Type 须为 JSON 或 multipart，且 multipart 另做同源 Origin/Referer 校验。',
      '**导入/导出**：导入为 `multipart/form-data` 文件上传；导出返回 xlsx 文件流。',
      '',
      '文档由代码内 DTO 推导生成；类型与描述不能替代服务端运行时校验、数据范围与权限裁决。',
    ].join('\n'))
    .addCookieAuth('access_token')
    .build()
  const document = SwaggerModule.createDocument(app, docConfig)
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' })
}
