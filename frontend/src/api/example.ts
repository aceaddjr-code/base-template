import request, { API_BASE, type FormRequestOptions } from './request'

export interface ExampleItem {
  id: number
  /** 单据编号：创建时后端生成（EX-yyyymmdd-001），全库唯一、不可修改 */
  docNo: string | null
  title: string
  status: 'pending' | 'doing' | 'done'
  description: string | null
  remark: string | null
  category?: string | null
  /** 单据负责人（记录归属人），创建时默认为创建人 */
  ownerId: number | null
  createdBy: number | null
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
/** 变更单据负责人：独立权限码 example-items:owner，负责人即记录归属人。失败由拦截器统一提示。 */
export function changeExampleOwner(id: number, ownerId: number): Promise<ExampleItem> { return request.post(`/examples/items/${id}/owner`, { ownerId }) as unknown as Promise<ExampleItem> }
export function deleteExample(id: number): Promise<void> { return request.delete(`/examples/items/${id}`) as unknown as Promise<void> }
export interface ImportRowError { row: number; message: string }
export interface ImportPreviewResult { total: number; valid: number; errors: ImportRowError[] }
export interface ImportResult { imported: number; total: number; errors: ImportRowError[] }

/** 导入会话（预检→confirm→结果查询/报告/修正文件） */
export interface ImportSessionPrecheck {
  importId: string
  expiresAt: string
  sheetName: string
  headerRowNumber: number
  total: number
  valid: number
  rows: Array<{ rowNumber: number; status: 'valid' | 'invalid'; message?: string }>
  duplicateOf?: { importId: string; createdAt: string }
}
export interface ImportSessionStatus {
  importId: string
  status: 'pending' | 'processing' | 'done' | 'failed' | 'expired'
  expiresAt: string
  fileName: string
  summary?: { total: number; success: number; invalid: number; unprocessed: number }
  rows?: Array<{ rowNumber: number; status: string; error?: string | null; createdDocNo?: string | null }>
}

export async function confirmImportSession(importId: string): Promise<ImportSessionStatus> {
  return request.post('/examples/items/import/confirm', { importId }, { timeout: 0 })
}
export async function getImportSession(importId: string): Promise<ImportSessionStatus> {
  return request.get(`/examples/items/import/${importId}`)
}
export function importReportUrl(importId: string): string {
  return `${API_BASE}/examples/items/import/${importId}/report`
}
export function importErrorFileUrl(importId: string): string {
  return `${API_BASE}/examples/items/import/${importId}/error-file`
}

export async function importExamples(file: File): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/examples/items/import', form)
}
/** 预检（F30）：与导入同套规则逐行校验,不写数据;确认导入时服务端会重新验证 */
/** 工具栏兼容形态：会话预检映射为预览统计（携带 importId/expiresAt 透传） */
export async function precheckExamplesForToolbar(file: File): Promise<{ total: number; valid: number; errors: { row: number; message: string }[]; importId: string; expiresAt: string; duplicate?: boolean }> {
  const session = await precheckExamples(file)
  return {
    total: session.total,
    valid: session.valid,
    errors: session.rows.filter(row => row.status === 'invalid').map(row => ({ row: row.rowNumber, message: row.message ?? '校验失败' })),
    importId: session.importId,
    expiresAt: session.expiresAt,
    duplicate: !!session.duplicateOf,
  }
}

/** 工具栏兼容形态：按 importId 确认，映射 summary 为部分成功结果 */
export async function confirmExamplesForToolbar(_file: File, importId?: string): Promise<{ imported: number; total: number; errors: { row: number; message: string }[]; unprocessed: number }> {
  if (!importId) throw new Error('导入会话缺失，请重新预检')
  const outcome = await confirmImportSession(importId)
  const summary = outcome.summary ?? { total: 0, success: 0, invalid: 0, unprocessed: 0 }
  return {
    imported: summary.success,
    total: summary.total,
    errors: (outcome.rows ?? []).filter(row => row.status === 'invalid' || row.status === 'infrastructure_error').map(row => ({ row: row.rowNumber, message: row.error ?? '写入失败' })),
    unprocessed: summary.unprocessed,
  }
}

export async function precheckExamples(file: File): Promise<ImportSessionPrecheck> {
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
