import request, { type FormRequestOptions } from './request'

export interface MenuItem {
  id: number
  parentId: number | null
  name: string
  path: string | null
  icon: string | null
  type: string
  permission: string | null
  sort: number
  status: number
  children?: MenuItem[]
  hasChildren?: boolean
}

/** 菜单列表（管理用） */
export function getMenus(): Promise<MenuItem[]> {
  return request.get('/menus')
}

/** 启用的菜单树 */
export function getMenuTree(): Promise<MenuItem[]> {
  return request.get('/menus/tree')
}

/** 菜单详情 */
export function getMenu(id: number): Promise<MenuItem> {
  return request.get(`/menus/${id}`)
}

/** 新增菜单 */
export function createMenu(data: {
  parentId?: number
  name: string
  path?: string
  icon?: string
  type?: string
  permission?: string
  sort?: number
}, options?: FormRequestOptions): Promise<MenuItem> {
  return request.post('/menus', data, options)
}

/** 编辑菜单 */
export function updateMenu(id: number, data: {
  name?: string
  path?: string
  icon?: string
  type?: string
  permission?: string | null
  sort?: number
  status?: number
}, options?: FormRequestOptions): Promise<MenuItem> {
  return request.put(`/menus/${id}`, data, options)
}

/** 删除菜单 */
export function deleteMenu(id: number): Promise<void> {
  return request.delete(`/menus/${id}`)
}
