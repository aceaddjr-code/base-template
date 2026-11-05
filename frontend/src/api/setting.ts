import request, { type FormRequestOptions } from './request'

/** 系统参数（管理页）：键/名称/类型来自后端注册表，value 为当前生效取值 */
export interface SettingItem {
  key: string
  name: string
  type: 'string' | 'text' | 'boolean'
  public: boolean
  description: string
  maxLength: number
  value: string
  defaultValue: string
  modified: boolean
  updatedAt: string | null
}

/** 管理列表（仅 admin）；第六批起返回 { list, revision }（乐观并发基准） */
export function getSettings(): Promise<{ list: SettingItem[]; revision: number }> {
  return request.get('/system/settings')
}

/** 登录用户可读的公开参数（key → 取值） */
export function getPublicSettings(): Promise<Record<string, string>> {
  return request.get('/system/settings/public')
}

export function updateSetting(key: string, value: string, options?: FormRequestOptions, baseRevision?: number): Promise<SettingItem> {
  return request.put(`/system/settings/${encodeURIComponent(key)}`, { value, ...(baseRevision !== undefined ? { baseRevision } : {}) }, options)
}

/** 原子批量更新：白名单/去重/组合校验/修订号条件更新（409→保留草稿） */
export function updateSettingsBatch(items: Array<{ key: string; value: string }>, baseRevision: number, options?: FormRequestOptions): Promise<{ list: SettingItem[]; revision: number }> {
  return request.put('/system/settings/batch', { items, baseRevision }, options)
}
