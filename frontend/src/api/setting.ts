import request, { type FormRequestOptions } from './request'

/** 系统参数（管理页）：键/名称/类型来自后端注册表，value 为当前生效取值 */
export interface SettingItem {
  key: string
  name: string
  type: 'string' | 'text'
  public: boolean
  description: string
  maxLength: number
  value: string
  defaultValue: string
  modified: boolean
  updatedAt: string | null
}

/** 管理列表（仅 admin） */
export function getSettings(): Promise<SettingItem[]> {
  return request.get('/system/settings')
}

/** 登录用户可读的公开参数（key → 取值） */
export function getPublicSettings(): Promise<Record<string, string>> {
  return request.get('/system/settings/public')
}

export function updateSetting(key: string, value: string, options?: FormRequestOptions): Promise<SettingItem> {
  return request.put(`/system/settings/${encodeURIComponent(key)}`, { value }, options)
}
