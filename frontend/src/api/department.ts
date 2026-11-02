import request, { type FormRequestOptions } from './request'

export interface Department {
  id: number
  name: string
  code: string
  parentId: number | null
  status: number
  sort: number
  createdAt: string
  updatedAt: string
  children?: Department[]
}

export function getDepartments(params?: { keyword?: string }): Promise<Department[]> {
  return request.get('/departments', { params })
}

/** 启用部门下拉（登录用户可用） */
export function getDepartmentsAll(): Promise<Department[]> {
  return request.get('/departments/all')
}

/** 编码由后端自动生成（dept-0001 全局流水），无需传入 */
export function createDepartment(data: { name: string; parentId?: number | null; status?: number; sort?: number }, options?: FormRequestOptions): Promise<Department> {
  return request.post('/departments', data, options)
}

export function updateDepartment(id: number, data: { name?: string; parentId?: number | null; status?: number; sort?: number }, options?: FormRequestOptions): Promise<Department> {
  return request.put(`/departments/${id}`, data, options)
}

export function deleteDepartment(id: number): Promise<void> {
  return request.delete(`/departments/${id}`)
}
