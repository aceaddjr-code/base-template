import request, { type FormRequestOptions } from './request'

export interface UserItem {
  id: number
  username: string
  displayName: string | null
  email: string | null
  phone: string | null
  status: number
  role: { id: number; name: string; code: string } | null
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

/** 新增本地账号 */
export function createUser(data: { loginid: string; password: string; displayName: string; email?: string; phone?: string; roleId?: number | null; roleIds?: number[]; deptId?: number | null; leaderId?: number | null }, options?: FormRequestOptions): Promise<UserItem> {
  return request.post('/users', data, options)
}

/** 编辑用户 */
export function updateUser(id: number, data: { password?: string; email?: string; phone?: string; roleId?: number | null; roleIds?: number[]; status?: number; displayName?: string; deptId?: number | null; leaderId?: number | null }, options?: FormRequestOptions): Promise<UserItem> {
  return request.put(`/users/${id}`, data, options)
}

/** 启用/禁用 */
export function toggleUserStatus(id: number): Promise<{ status: number }> {
  return request.patch(`/users/${id}/status`)
}

/** 删除用户 */
export function deleteUser(id: number): Promise<void> {
  return request.delete(`/users/${id}`)
}

export interface UserDataScopeRow {
  id?: number
  scopeKey: string
  scopeType: string
  viewOthers: number
  editOthers: number
  deleteOthers: number
  targets: number[]
}

/** 查询用户业务数据范围配置（全量行；无配置返回默认 __global__ self 行） */
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
