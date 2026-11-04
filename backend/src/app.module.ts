import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionGuard } from './modules/auth/guards/permission.guard';
import { MustChangePasswordGuard } from './modules/auth/guards/must-change-password.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { MenuModule } from './modules/menu/menu.module';
import { DepartmentModule } from './modules/department/department.module';
import { SystemModule } from './modules/system/system.module';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { ExampleModule } from './modules/example/example.module';
import { UploadModule } from './common/uploads/upload.module';
import { FrontendErrorController } from './modules/monitor/frontend-error.controller';
import { HealthController } from './modules/monitor/health.controller';
import { DiagnosticsController } from './modules/monitor/diagnostics.controller';
import { HealthService } from './modules/monitor/health.service';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validateEnvironment }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '3306')),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE', 'app_starter'),
        autoLoadEntities: true,
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
        logging: config.get<string>('NODE_ENV') === 'development' ? true : ['error'],
      }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 300 }] }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN', '7d') || '7d') as '7d' },
      }),
    }),
    AuthModule,
    UserModule,
    RoleModule,
    MenuModule,
    DepartmentModule,
    SystemModule,
    AttachmentModule,
    ExampleModule,
    UploadModule,
  ],
  controllers: [AppController, FrontendErrorController, HealthController, DiagnosticsController],
  providers: [
    HealthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 待改密门禁位于认证之后、角色/操作权限之前（规格 3.3）。
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
