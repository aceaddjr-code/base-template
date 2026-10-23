import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { resolve } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser:false });
  const config = app.get(ConfigService);
  configureApplication(app, config);
  app.useStaticAssets(resolve(process.cwd(), config.get<string>('UPLOAD_DIR', 'uploads')), {
    prefix:'/uploads/', maxAge:'7d',
  });
  app.enableShutdownHooks();
  const port = Number(config.get<string>('PORT', '3010'));
  await app.listen(port);
  Logger.log(`API: http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
