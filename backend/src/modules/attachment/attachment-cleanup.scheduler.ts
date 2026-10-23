import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentService } from './attachment.service';

/** 过期临时附件清理调度：启动 1 分钟后首扫,此后每小时一次（应用关闭时清理定时器） */
@Injectable()
export class AttachmentCleanupScheduler implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private initial?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const retention = this.config.get<number>('ATTACHMENT_TEMP_RETENTION_HOURS', 24);
    this.initial = setTimeout(() => {
      void this.attachmentService.sweepExpiredTemp(retention);
    }, 60_000);
    this.initial.unref?.();
    this.timer = setInterval(() => {
      void this.attachmentService.sweepExpiredTemp(retention);
    }, 3600_000);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.initial);
    clearInterval(this.timer);
  }
}
