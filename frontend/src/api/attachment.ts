import request, { type FormRequestOptions } from './request'

export type AttachmentStatus = 'temp' | 'bound'

export interface AttachmentItem {
  id: number
  name: string
  mimeType: string
  size: number
  status: AttachmentStatus
  entityType: string | null
  entityId: number | null
  mine: boolean
  createdAt: string
}

export interface AttachmentPage {
  list: AttachmentItem[]
  total: number
  page: number
  pageSize: number
}

export function getAttachments(params: { page?: number; pageSize?: number; status?: AttachmentStatus }): Promise<AttachmentPage> {
  return request.get('/attachments', { params })
}

export function uploadAttachment(file: File, options?: FormRequestOptions): Promise<AttachmentItem> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/attachments', form, options)
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
