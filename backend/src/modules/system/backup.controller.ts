import { Controller, Get, Post, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { BackupService } from './backup.service';

@Controller('system/backups')
@Roles('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /** 备份文件列表（时间降序） */
  @Get()
  async list() {
    return this.backupService.listBackups();
  }

  /** 本进程最近一次手动备份状态；进程重启后为 idle。 */
  @Get('status')
  status() { return this.backupService.status(); }

  /** 立即备份（异步执行子进程，完成后返回结果） */
  @Post('backup')
  async backup() {
    return this.backupService.runBackup();
  }

  /** 下载备份文件（文件名白名单防穿越） */
  @Get(':filename/download')
  async download(@Param('filename') filename: string, @Res() res: Response) {
    const { path, size } = await this.backupService.getBackupFile(filename);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', String(size));
    this.backupService.stream(path).pipe(res);
  }
}
