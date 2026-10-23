import request, { type FormRequestOptions } from './request'

export interface RoleItem {
  id: number
  name: string
  code: string
  description: string | null
  status: number
  menus: { id: number; name: string }[]
  createdAt: string
}

export interface RoleOption {
  id: number
  name: string
  code: string
}

/** 角色列表 */
export function getRoles(params?: { page?: number; pageSize?: number }): Promise<{
  list: RoleItem[]
  total: number
  page: number
  pageSize: number
}> {
  return request.get('/roles', { params })
}

/** 全部角色（下拉用） */
export function getAllRoles(): Promise<RoleOption[]> {
  return request.get('/roles/all')
}

/** 角色详情 */
export function getRole(id: number): Promise<RoleItem> {
  return request.get(`/roles/${id}`)
}

/** 获取角色的菜单权限 */
export function getRoleMenuIds(id: number): Promise<number[]> {
  return request.get(`/roles/${id}/menus`)
}

/** 新增角色 */
export function createRole(data: { name: string; code: string; description?: string }, options?: FormRequestOptions): Promise<RoleItem> {
  return request.post('/roles', data, options)
}

/** 编辑角色 */
export function updateRole(id: number, data: { name?: string; description?: string }, options?: FormRequestOptions): Promise<RoleItem> {
  return request.put(`/roles/${id}`, data, options)
}

/** 分配菜单权限 */
export function assignRoleMenus(id: number, menuIds: number[]): Promise<RoleItem> {
  return request.post(`/roles/${id}/menus`, { menuIds })
}

/** 删除角色 */
export function deleteRole(id: number): Promise<void> {
  return request.delete(`/roles/${id}`)
}
