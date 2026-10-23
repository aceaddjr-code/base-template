import request from './request'

export const NOTIFICATIONS_CHANGED = 'starter:notifications-changed'

export interface NotificationItem {
  id: number
  userId: number
  type: string
  title: string
  content: string | null
  bizType: string | null
  bizId: number | null

  readAt: string | null
  createdAt: string
}

/** 我的通知分页列表 */
export function getNotifications(params: { page?: number; pageSize?: number; readStatus?: 'all' | 'unread' } = {}, signal?: AbortSignal): Promise<{ list: NotificationItem[]; total: number; page: number; pageSize: number }> {
  return request.get('/system/notifications', { params, signal })
}

/** 未读数 */
export function getUnreadCount(): Promise<{ count: number }> {
  return request.get('/system/notifications/unread-count')
}

/** 标已读 */
export async function markRead(id: number) {
  const result = await request.post(`/system/notifications/${id}/read`)
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
  return result
}

/** 全部已读 */
export async function markAllRead() {
  const result = await request.post('/system/notifications/read-all')
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
  return result
}
