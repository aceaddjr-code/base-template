import request, { type FormRequestOptions } from './request'

export const ATTACHMENT_MAX_SIZE = 500 * 1024 * 1024

export type AttachmentStatus = 'temp' | 'bound'
/** center=附件管理直传（文件库）；business=业务表单上传 */
export type AttachmentOrigin = 'center' | 'business'

export interface AttachmentItem {
  id: number
  name: string
  mimeType: string
  size: number
  status: AttachmentStatus
  origin: AttachmentOrigin
  entityType: string | null
  entityId: number | null
  /** 绑定时单据标题快照，用于展示与穿透 */
  entityTitle: string | null
  /** 上传人显示名（displayName 缺省回退用户名；用户被删为 null） */
  uploaderName: string | null
  mine: boolean
  ownerId?: number | null
  createdAt: string
}

export interface AttachmentPage {
  list: AttachmentItem[]
  total: number
  page: number
  pageSize: number
}

export interface AttachmentQuery {
  page?: number
  pageSize?: number
  origin?: AttachmentOrigin
  status?: AttachmentStatus
  entityType?: string
  keyword?: string
}

export function getAttachments(params: AttachmentQuery, signal?: AbortSignal): Promise<AttachmentPage> {
  return request.get('/attachments', { params, signal })
}

export function uploadAttachment(file: File, options?: FormRequestOptions & { signal?: AbortSignal }): Promise<AttachmentItem> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/attachments', form, { ...options, timeout: 30 * 60 * 1000 })
}

export function deleteAttachment(id: number): Promise<{ message: string }> {
  return request.delete(`/attachments/${id}`)
}

/** 下载走授权接口(带 Cookie),取回 blob 由调用方保存 */
export function attachmentDownloadUrl(id: number): string {
  return `/api/v1/attachments/${id}/download`
}

export function cleanupAttachments(): Promise<number> {
  return request.post('/attachments/cleanup')
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
