import request, { type FormRequestOptions } from './request'

export interface UserItem {
  id: number
  username: string
  displayName: string | null
  email: string | null
  phone: string | null
  status: number
  role: { id: number; name: string; code: string } | null
  /** 主角色之外的附加角色 id（列表与更新接口实际返回） */
  roleIds?: number[]
  deptId: number | null
  dept?: { id: number; name: string; code: string } | null
  leaderId: number | null
  createdAt: string
  updatedAt: string
}

export interface PaginatedResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export interface UserSimple {
  id: number
  username: string
  displayName: string | null
  deptId: number | null
  deptName?: string | null
}

/** 管理员用户下拉，每次请求获取当前数据。 */
export function getUsersSimple(): Promise<UserSimple[]> {
  return request.get('/users/simple')
}

/** 用户列表（筛选字段与后端登记一致：keyword/deptId/status/createdAtFrom/createdAtTo） */
export function getUsers(params: {
  page?: number
  pageSize?: number
  keyword?: string
  deptId?: number
  status?: string
  createdAtFrom?: string
  createdAtTo?: string
}, signal?: AbortSignal): Promise<PaginatedResult<UserItem>> {
  return request.get('/users', { params, signal })
}

/** 一次性临时凭据：仅创建/重置成功响应返回一次，不落任何持久化 */
export interface TemporaryCredential {
  temporaryPassword: string
  /** ISO UTC 到期时间 */
  expiresAt: string
}

/** 新增本地账号：临时密码由服务端生成，随响应一次性返回 */
export function createUser(data: { loginid: string; displayName: string; email?: string; phone?: string; roleId?: number | null; roleIds?: number[]; deptId?: number | null; leaderId?: number | null }, options?: FormRequestOptions): Promise<UserItem & TemporaryCredential> {
  return request.post('/users', data, options)
}

/** 编辑用户（密码不再经普通编辑修改，使用重置动作） */
export function updateUser(id: number, data: { email?: string; phone?: string; roleId?: number | null; roleIds?: number[]; status?: number; displayName?: string; deptId?: number | null; leaderId?: number | null }, options?: FormRequestOptions): Promise<UserItem> {
  return request.put(`/users/${id}`, data, options)
}

/** 管理员重置密码：生成一次性临时密码并要求目标下次登录改密 */
export function resetUserPassword(id: number): Promise<TemporaryCredential> {
  return request.post(`/users/${id}/reset-password`)
}

/** 退出目标账号全部登录：旧凭据立即失效，可重新登录 */
export function revokeUserSessions(id: number): Promise<{ message: string }> {
  return request.post(`/users/${id}/revoke-sessions`)
}

/** 启用/禁用 */
export function toggleUserStatus(id: number): Promise<{ status: number }> {
  return request.patch(`/users/${id}/status`)
}

/** 删除用户 */
export function deleteUser(id: number): Promise<void> {
  return request.delete(`/users/${id}`)
}

/** 数据范围类型（与后端 common/utils/data-scope 的 SCOPE_TYPES 同一字符串族） */
export type ScopeType = 'self' | 'all' | 'by_users' | 'by_depts'
/** 配置行：六个开关由后端按缺省口径归一化后下发，前端不自行复刻缺省值 */
export interface UserDataScopeRow {
  id?: number
  scopeKey: string
  scopeType: ScopeType
  viewOthers: number
  editOthers: number
  deleteOthers: number
  targets: number[]
  viewSelf: number
  editSelf: number
  deleteSelf: number
}

/** 查询用户业务数据范围配置（全量行；无配置返回空数组，未配置表单按仅本人处理） */
export function getUserDataScopes(id: number): Promise<UserDataScopeRow[]> {
  return request.get(`/users/${id}/data-scopes`)
}

/** 保存用户业务数据范围（全量替换，body: { rows: [...] }） */
export function saveUserDataScopes(id: number, rows: Partial<UserDataScopeRow>[]): Promise<UserDataScopeRow[]> {
  return request.put(`/users/${id}/data-scopes`, { rows })
}

export interface ScopeFormMeta {
  scopeKey: string
  label: string
}
export function getScopeForms(): Promise<ScopeFormMeta[]> {
  return request.get('/users/scope-forms')
}
