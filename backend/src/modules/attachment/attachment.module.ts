import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from './attachment.entity';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentCleanupScheduler } from './attachment-cleanup.scheduler';
import { SystemModule } from '../system/system.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment]),
    // SystemModule 提供 SystemLogService;AuthModule 提供 JwtPayload 所需的装饰器依赖
    SystemModule,
    AuthModule,
  ],
  controllers: [AttachmentController],
  providers: [AttachmentService, AttachmentCleanupScheduler],
  exports: [AttachmentService],
})
export class AttachmentModule {}
