import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { AttachmentService } from './attachment.service';

/** 已删除附件的磁盘文件回收调度：启动 1 分钟后首扫,此后每小时一次（应用关闭时清理定时器） */
@Injectable()
export class AttachmentCleanupScheduler implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private initial?: ReturnType<typeof setTimeout>;

  constructor(private readonly attachmentService: AttachmentService) {}

  onModuleInit(): void {
    this.initial = setTimeout(() => {
      void this.attachmentService.sweepDeletedFiles();
    }, 60_000);
    this.initial.unref?.();
    this.timer = setInterval(() => {
      void this.attachmentService.sweepDeletedFiles();
    }, 3600_000);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.initial);
    clearInterval(this.timer);
  }
}
