import gettingStarted from './getting-started.md?raw'
import pages from './pages.md?raw'
import faq from './faq.md?raw'
import changelog from './changelog.md?raw'

export interface HelpSection {
  id: string
  title: string
  markdown: string
}

export const HELP_SECTIONS: HelpSection[] = [
  { id: 'getting-started', title: '快速上手', markdown: gettingStarted },
  { id: 'pages', title: '各页面说明', markdown: pages },
  { id: 'faq', title: '常见问题', markdown: faq },
  { id: 'changelog', title: '更新记录', markdown: changelog },
]

/** 按页关联：路由路径 → 帮助小节。与固定入口/菜单路径保持一致，新增页面时同步登记。 */
export interface PageHelpEntry {
  route: string
  sectionId: string
  heading: string
}

export const PAGE_HELP: PageHelpEntry[] = [
  { route: '/home', sectionId: 'pages', heading: '首页' },
  { route: '/examples/items', sectionId: 'pages', heading: '示例事项' },
  { route: '/system/users', sectionId: 'pages', heading: '用户管理' },
  { route: '/system/roles', sectionId: 'pages', heading: '角色 / 菜单 / 数据字典' },
  { route: '/system/menus', sectionId: 'pages', heading: '角色 / 菜单 / 数据字典' },
  { route: '/system/dict', sectionId: 'pages', heading: '角色 / 菜单 / 数据字典' },
  { route: '/system/notifications', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
  { route: '/system/announcements', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
  { route: '/system/settings', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
  { route: '/system/attachments', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
  { route: '/system/backups', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
  { route: '/system/logs', sectionId: 'pages', heading: '系统管理（通知 / 公告 / 参数 / 附件 / 备份 / 日志）' },
]

export function pageHelpFor(routePath: string): PageHelpEntry | undefined {
  return PAGE_HELP.find((entry) => entry.route === routePath)
}
