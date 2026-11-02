import request, { API_BASE, type FormRequestOptions } from './request'

export interface ExampleItem {
  id: number
  title: string
  status: 'pending' | 'doing' | 'done'
  description: string | null
  category?: string | null
  ownerId: number | null
  /** 乐观锁版本（F06）：编辑保存时回传，服务端按原值做条件更新 */
  version: number
  createdAt: string
  updatedAt: string
}

export function listExamples(params: Record<string, any>, signal?: AbortSignal): Promise<{ list: ExampleItem[]; total: number }> {
  return request.get('/examples/items', { params, signal })
}
export function getExample(id: number, options?: FormRequestOptions): Promise<ExampleItem> { return request.get(`/examples/items/${id}`, options) }
export type DocumentTab = HistoryTab | 'attachments'
export type HistoryTab = 'detail' | 'activity' | 'operations' | 'changes'
export interface ExampleEvent {
  id: number; itemId: number; action: string; result: string; actorId: number; actorName: string
  occurredAt: string; objectLabel: string; source: string; version: number; batchId: string | null; rowNumber: number | null
  changes?: Array<{ id: number; fieldKey: string; fieldLabel: string; valueType: string; beforeValue: unknown; afterValue: unknown; beforeLabel: string | null; afterLabel: string | null }>
}
export interface HistoryResult { list: ExampleEvent[]; total: number; upper: number; pageSize?: number; nextCursor: string | null; notice: string }
export function accessExample(id: number, data: { action: 'view' | 'print'; interactionId: string; expectedVersion?: number }): Promise<{ record: ExampleItem; eventId: number }> {
  return request.post(`/examples/items/${id}/access-events`, data, { errorFeedback: 'form' })
}
export function getExampleHistory(id: number, tab: Exclude<HistoryTab, 'detail'>, params: Record<string, unknown>): Promise<HistoryResult> {
  return request.get(`/examples/items/${id}/${tab}`, { params, errorFeedback: 'form' })
}
export function createExample(data: Partial<ExampleItem>, options?: FormRequestOptions): Promise<ExampleItem> { return request.post('/examples/items', data, options) as unknown as Promise<ExampleItem> }
export function updateExample(id: number, data: Partial<ExampleItem>, options?: FormRequestOptions): Promise<ExampleItem> { return request.put(`/examples/items/${id}`, data, options) as unknown as Promise<ExampleItem> }
export function deleteExample(id: number): Promise<void> { return request.delete(`/examples/items/${id}`) as unknown as Promise<void> }
export interface ImportRowError { row: number; message: string }
export interface ImportPreviewResult { total: number; valid: number; errors: ImportRowError[] }
export interface ImportResult { imported: number; total: number; errors: ImportRowError[] }

export async function importExamples(file: File): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/examples/items/import', form)
}
/** 预检（F30）：与导入同套规则逐行校验,不写数据;确认导入时服务端会重新验证 */
export async function precheckExamples(file: File): Promise<ImportPreviewResult> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/examples/items/import/precheck', form)
}
/** 模板直链（F30）：浏览器携带登录 Cookie 下载,服务端按导入权限鉴权 */
export const exampleImportTemplateUrl = `${API_BASE}/examples/items/import/template`
export interface ExampleListQuery {
  keyword?: string
  status?: string
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  createdAtFrom?: string
  createdAtTo?: string
  updatedAtFrom?: string
  updatedAtTo?: string
}

export interface ExampleBatchResult {
  successCount: number
  total: number
  failures: Array<{ id: number; reason: string }>
}

export function batchDeleteExamples(ids: number[]): Promise<ExampleBatchResult> {
  return request.post('/examples/items/batch/remove', { ids })
}

/** 导出与列表共用查询口径；列 key 直接来自当前可见列，服务端白名单兜底。 */
export function getExampleExportUrl(params: ExampleListQuery & { cols: string; ids?: string }): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  return `${API_BASE}/examples/items/export?${query}`
}

export interface ExampleFile { id: number; name: string; size: number; mimeType: string; image: boolean; previewable?: boolean; createdAt: string }
export function getExampleFiles(id: number): Promise<ExampleFile[]> { return request.get(`/examples/items/${id}/attachments`, { errorFeedback: 'form' }) }
export function addExampleFile(id: number, attachmentId: number): Promise<{ id: number }> { return request.post(`/examples/items/${id}/attachments`, { attachmentId }, { errorFeedback: 'form' }) }
export function removeExampleFile(id: number, fileId: number): Promise<void> { return request.delete(`/examples/items/${id}/attachments/${fileId}`, { errorFeedback: 'form' }) }
export function exampleFileUrl(id: number, fileId: number, preview = false): string { return `${API_BASE}/examples/items/${id}/attachments/${fileId}/download${preview ? '?preview=1' : ''}` }

/** 单据临时文件上传按单据编辑权限，不依赖附件管理授权。 */
export function uploadExampleAttachment(file: File, options?: FormRequestOptions & { signal?: AbortSignal }): Promise<{ id: number }> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/examples/items/attachments/upload', form, { ...options, timeout: 30 * 60 * 1000 })
}
