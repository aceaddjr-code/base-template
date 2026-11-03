import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { message } from 'ant-design-vue'
import { useAppStore } from '@/stores/app'
import { FIXED_MENU_ENTRIES } from './fixed-entries'
import { hasAccessByCodes, hasAccessByRoles } from '@/utils/access'

const BasicLayout = () => import('@/layouts/BasicLayout.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: BasicLayout,
    redirect: '/home',
    meta: { requiresAuth: true },
    children: [
      { path: 'system/recycle-bin', component: () => import('@/views/system/recycle-bin/index.vue'), meta: { title: '回收站', requiresAuth: true } },
      { path: 'home', component: () => import('@/views/home/index.vue'), meta: { title: '首页', requiresAuth: true } },
      { path: 'examples/items', component: () => import('@/views/examples/items/index.vue'), meta: { title: '示例事项', requiresAuth: true } },
      { path: 'system/users', component: () => import('@/views/system/users/index.vue'), meta: { title: '用户管理', searchAliases: ['账号', '人员'], requiresAuth: true } },
      { path: 'system/roles', component: () => import('@/views/system/roles/index.vue'), meta: { title: '角色管理', searchAliases: ['授权', '角色权限'], requiresAuth: true } },
      { path: 'system/menus', component: () => import('@/views/system/menus/index.vue'), meta: { title: '菜单管理', requiresAuth: true } },
      { path: 'system/dict', component: () => import('@/views/system/dict/index.vue'), meta: { title: '数据字典', searchAliases: ['字典', '选项'], accessCode: 'dicts:view', requiresAuth: true } },
      { path: 'system/logs', component: () => import('@/views/system/logs/index.vue'), meta: { title: '操作日志', searchAliases: ['审计', '操作记录'], accessCode: 'system-logs:view', requiresAuth: true } },
      { path: 'system/backups', component: () => import('@/views/system/backups/index.vue'), meta: { title: '数据备份', searchAliases: ['数据库备份'], requiresAuth: true } },
      { path: 'system/settings', component: () => import('@/views/system/settings/index.vue'), meta: { title: '系统参数', searchAliases: ['参数', '配置'], requiresAuth: true } },
      { path: 'system/notifications', component: () => import('@/views/system/notifications/index.vue'), meta: { title: '我的通知', searchAliases: ['消息', '通知'], requiresAuth: true } },
      { path: 'system/announcements', component: () => import('@/views/system/announcements/index.vue'), meta: { title: '系统公告', searchAliases: ['公告', '通知发布'], accessCode: 'announcements:view', requiresAuth: true } },
      { path: 'system/attachments', component: () => import('@/views/system/attachments/index.vue'), meta: { title: '附件管理', searchAliases: ['附件', '文件'], accessCode: 'attachments:view', requiresAuth: true } },
    ],
  },
  { path: '/announcements', component: () => import('@/views/announcements/index.vue'), meta: { title: '历史公告', searchAliases: ['公告'], requiresAuth: true } },
  { path: '/help', component: () => import('@/views/help/index.vue'), meta: { title: '帮助中心', requiresAuth: true } },
  { path: '/login', component: () => import('@/views/login/index.vue'), meta: { title: '登录' } },
  { path: '/:pathMatch(.*)*', component: () => import('@/views/error/404.vue'), meta: { title: '404' } },
]

const router = createRouter({ history: createWebHistory(), routes })

function collectMenuPaths(items: { path?: string | null; children?: any[] }[], result = new Set(FIXED_MENU_ENTRIES.map((entry) => entry.path))) {
  for (const item of items) {
    if (item.path) result.add(item.path)
    if (item.children?.length) collectMenuPaths(item.children, result)
  }
  return result
}

router.beforeEach(async (to) => {
  // 标题跟随系统参数 site.name（未登录/未加载时回退构建配置）
  document.title = `${String(to.meta.title || '')} - ${useAppStore().siteName}`
  if (!to.matched.some(record => record.meta.requiresAuth)) return true
  if (!(await useAppStore().ensureSession())) return { path: '/login', query: { redirect: to.fullPath === '/' ? undefined : to.fullPath } }
  if (!collectMenuPaths(useAppStore().menus).has(to.path)) {
    message.warning('无权访问该页面')
    return '/404'
  }
  if (typeof to.meta.accessCode === 'string' && !hasAccessByRoles('admin') && !hasAccessByCodes(to.meta.accessCode)) {
    message.warning('无权访问该页面')
    return '/404'
  }
  return true
})

export default router
