import request, { type FormRequestOptions } from './request'

export type AnnouncementStatus = 'draft' | 'published' | 'withdrawn'

/** 管理列表/详情（admin 或详情阅读接口返回） */
export interface AnnouncementItem {
  id: number
  title: string
  content: string
  status: AnnouncementStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 已发布列表摘要（登录用户） */
export interface AnnouncementBrief {
  id: number
  title: string
  publishedAt: string
}

export interface AnnouncementPage<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 管理列表（仅 admin） */
export function getAnnouncements(params: { page?: number; pageSize?: number; status?: AnnouncementStatus; keyword?: string }): Promise<AnnouncementPage<AnnouncementItem>> {
  return request.get('/system/announcements', { params })
}

/** 已发布列表（登录用户） */
export function getPublishedAnnouncements(params: { page?: number; pageSize?: number }): Promise<AnnouncementPage<AnnouncementBrief>> {
  return request.get('/system/announcements/published', { params })
}

export function getAnnouncementDetail(id: number): Promise<AnnouncementItem> {
  return request.get(`/system/announcements/${id}`)
}

export function createAnnouncement(data: { title: string; content: string }, options?: FormRequestOptions): Promise<AnnouncementItem> {
  return request.post('/system/announcements', data, options)
}

export function updateAnnouncement(id: number, data: { title: string; content: string }, options?: FormRequestOptions): Promise<AnnouncementItem> {
  return request.put(`/system/announcements/${id}`, data, options)
}

export function publishAnnouncement(id: number): Promise<AnnouncementItem> {
  return request.post(`/system/announcements/${id}/publish`)
}

export function withdrawAnnouncement(id: number): Promise<AnnouncementItem> {
  return request.post(`/system/announcements/${id}/withdraw`)
}

export function deleteAnnouncement(id: number): Promise<{ message: string }> {
  return request.delete(`/system/announcements/${id}`)
}
