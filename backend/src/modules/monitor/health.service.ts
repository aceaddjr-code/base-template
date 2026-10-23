import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PING_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly appVersion: string;

  constructor(private readonly dataSource: DataSource) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
      this.appVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
      this.appVersion = 'unknown';
    }
  }

  /** 存活探针：仅证明进程在运行，不检查任何依赖，供编排器判活 */
  live() {
    return { status: 'ok' as const };
  }

  /** 就绪探针：数据库不可达时返回 503，编排器据此摘除流量 */
  async ready() {
    const connected = await this.ping();
    if (!connected) throw new ServiceUnavailableException('数据库未就绪，暂时不接收流量');
    return { status: 'ready' as const, database: 'connected' as const };
  }

  /** 信息聚合状态（兼容原 /health 响应结构）；流量判定以 /health/ready 为准 */
  async aggregate() {
    const connected = await this.ping();
    return {
      status: connected ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: connected ? 'connected' : 'disconnected',
    };
  }

  /**
   * 管理端诊断：仅运行状态与可用性。
   * 不含密钥、连接串、主机名与绝对路径；数据库只报连通性与延迟。
   */
  async diagnostics() {
    const pingStart = Date.now();
    const connected = await this.ping();
    const pingMs = connected ? Date.now() - pingStart : null;
    const memory = process.memoryUsage();
    const attachments = await this.checkAttachments();
    return {
      status: 'running',
      environment: process.env.NODE_ENV || 'development',
      appVersion: this.appVersion,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
      database: { connected, pingMs },
      attachments,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkAttachments() {
    const retentionHours = Number(process.env.ATTACHMENT_TEMP_RETENTION_HOURS || 24);
    try {
      const dir = resolve(process.cwd(), process.env.ATTACHMENT_PRIVATE_DIR || 'uploads-private');
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fs.constants.W_OK);
      return { privateDirWritable: true, tempRetentionHours: retentionHours };
    } catch {
      return { privateDirWritable: false, tempRetentionHours: retentionHours };
    }
  }

  private async ping(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ping timeout')), PING_TIMEOUT_MS) }),
      ]);
      return true;
    } catch (error) {
      this.logger.warn(`数据库健康检查失败: ${error instanceof Error ? error.name : 'unknown'}`);
      return false;
    } finally {
      clearTimeout(timer)
    }
  }
}
