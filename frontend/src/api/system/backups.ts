import request from '../request'
import { API_BASE } from '../request'

/** 备份条目（第三批起区分两类：完整集合以磁盘 manifest 为状态事实来源） */
export type BackupFile =
  | { type: 'database-only'; filename: string; size: number; date: string }
  | { type: 'full-set'; filename: string; backupId: string; state: 'creating' | 'complete' | 'failed' | 'corrupt'; date: string; size?: number; error?: string | null }

/** 兼容缺省：旧后端/历史行未携带 type 时按仅数据库处理 */
export function isFullSet(entry: BackupFile): boolean {
  return entry.type === 'full-set'
}

/** 备份文件列表（admin-only） */
export function listBackups(): Promise<BackupFile[]> {
  return request.get('/system/backups')
}

export interface BackupStatus {
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  startedAt?: string
  finishedAt?: string
  result?: BackupFile
  message?: string
}

export function getBackupStatus(): Promise<BackupStatus> {
  return request.get('/system/backups/status')
}

/** 完成后返回；服务端有执行超时，不使用普通读取的 10 秒超时。 */
export function createBackup(): Promise<BackupFile> {
  return request.post('/system/backups/backup', undefined, { timeout: 0 })
}

/** 下载 URL（浏览器原生下载，接口 admin-only） */
export function getBackupDownloadUrl(filename: string): string {
  return `${API_BASE}/system/backups/${encodeURIComponent(filename)}/download`
}
