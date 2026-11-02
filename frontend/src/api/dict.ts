import request, { type FormRequestOptions } from './request'

/** 字典查询结果（useDict 数据源） */
export interface DictOption {
  label: string
  value: string
  color: string | null
}

/** 字典查询结果（useDict 数据源） */
export interface DictData {
  code: string
  name: string
  options: DictOption[]
}

/** 字典类型（管理页） */
export interface DictTypeItem {
  id: number
  code: string
  name: string
  status: number
  remark: string | null
  itemCount?: number
  createdAt: string
}

/** 字典选项（管理页） */
export interface DictItem {
  id: number
  typeId: number
  label: string
  value: string
  color: string | null
  sort: number
  status: number
  remark: string | null
}

/** 按类型编码查询（启用选项，全员可用） */
export function getDict(typeCode: string): Promise<DictData> {
  return request.get(`/system/dicts/${typeCode}`)
}

/** 含停用项的全量选项（F40：仅供存量历史值的标签回显，全员可用） */
export function getDictAll(typeCode: string): Promise<DictData & { options: (DictOption & { status: number })[] }> {
  return request.get(`/system/dicts/${typeCode}/all`)
}

/** 字典类型列表（dicts:view） */
export function getDictTypes(params: { page?: number; pageSize?: number; keyword?: string }) {
  return request.get('/system/dicts/types', { params }) as Promise<{
    list: DictTypeItem[]
    total: number
    page: number
    pageSize: number
  }>
}

export function createDictType(data: { code: string; name: string; remark?: string }, options?: FormRequestOptions) {
  return request.post('/system/dicts/types', data, options)
}

export function updateDictType(id: number, data: Partial<{ code: string; name: string; status: number; remark: string }>, options?: FormRequestOptions) {
  return request.put(`/system/dicts/types/${id}`, data, options)
}

export function deleteDictType(id: number) {
  return request.delete(`/system/dicts/types/${id}`)
}

/** 某类型的选项列表（admin） */
export function getDictItems(typeId: number): Promise<DictItem[]> {
  return request.get(`/system/dicts/types/${typeId}/items`)
}

export function createDictItem(typeId: number, data: Partial<DictItem>, options?: FormRequestOptions) {
  return request.post(`/system/dicts/types/${typeId}/items`, data, options)
}

export function updateDictItem(id: number, data: Partial<DictItem>, options?: FormRequestOptions) {
  return request.put(`/system/dicts/items/${id}`, data, options)
}

export function deleteDictItem(id: number) {
  return request.delete(`/system/dicts/items/${id}`)
}
