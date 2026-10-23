import request from './request'

export interface LogItem {
  id: number
  userId: number | null
  username: string | null
  action: string
  entityType: string | null
  entityId: number | null
  entityDesc: string | null
  detail: string | null
  ip: string | null
  createdAt: string
}

export interface LogQuery {
  page?: number
  pageSize?: number
  keyword?: string
  action?: string
  entityType?: string
  username?: string
  dateFrom?: string
  dateTo?: string
}

/** 审计日志查询（admin） */
export function getLogs(params: LogQuery, signal?: AbortSignal) {
  return request.get('/system/logs', { params, signal }) as Promise<{
    list: LogItem[]
    total: number
    page: number
    pageSize: number
  }>
}
