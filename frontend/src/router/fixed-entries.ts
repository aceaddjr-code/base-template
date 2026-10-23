/** 登录即达的固定入口：路由守卫白名单与 MenuSearch 固定项共用，避免两处清单漂移 */
export interface FixedMenuEntry {
  name: string
  path: string
}

export const FIXED_MENU_ENTRIES: FixedMenuEntry[] = [
  { name: '首页', path: '/home' },
  { name: '我的通知', path: '/system/notifications' },
  { name: '历史公告', path: '/announcements' },
  { name: '帮助中心', path: '/help' },
]
