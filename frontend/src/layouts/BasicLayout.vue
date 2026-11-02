<template>
  <a-layout class="app-shell">
    <!-- 窄屏改为抽屉式侧栏：内容区占满宽度，遮罩点击关闭。 -->
    <div v-if="mobileOpen" class="sider-mask" aria-hidden="true" @click="mobileOpen = false" />
    <a-layout-sider
      :collapsed="siderCollapsed"
      :trigger="null"
      :collapsible="!isMobile"
      :width="220"
      :collapsed-width="64"
      class="main-sider"
      :class="{ 'is-mobile-open': mobileOpen }"
    >
      <button type="button" class="brand" aria-label="返回首页" @click="router.push('/')">
        <span class="brand-symbol" aria-hidden="true"><BrandMark :size="16" /></span>
        <span v-if="!siderCollapsed" class="brand-text">
          <strong>{{ appName }}</strong>
        </span>
      </button>
      <nav class="menu-scroll" aria-label="主导航">
        <a-menu v-model:selectedKeys="selectedKeys" v-model:openKeys="openKeys" mode="inline" theme="light" @click="onMenuClick">
          <template v-for="item in appStore.menus" :key="item.path || item.id">
            <a-sub-menu v-if="item.children?.length" :key="item.path">
              <template #icon><component :is="menuIcon(item.icon, true)" /></template>
              <template #title>{{ item.name }}</template>
              <!-- 子菜单不再重复上级图标：层级靠缩进表达，图标只标记一级模块。 -->
              <a-menu-item v-for="child in item.children.filter((x: any) => x.type !== 'button')" :key="child.path">{{ child.name }}</a-menu-item>
            </a-sub-menu>
            <a-menu-item v-else-if="item.type !== 'button'" :key="item.path">
              <template #icon><component :is="menuIcon(item.icon)" /></template>
              {{ item.name }}
            </a-menu-item>
          </template>
        </a-menu>
      </nav>
    </a-layout-sider>

    <a-layout class="main-area" :class="{ 'is-collapsed': siderCollapsed && !isMobile }">
      <a-layout-header class="header-bar">
        <div class="header-left">
          <a-tooltip :title="triggerLabel" placement="bottomLeft">
            <button
              type="button"
              class="trigger"
              :aria-label="triggerLabel"
              :aria-expanded="isMobile ? mobileOpen : !appStore.sidebarCollapsed"
              @click="toggleSidebar"
            >
              <menu-outlined v-if="isMobile" />
              <menu-unfold-outlined v-else-if="appStore.sidebarCollapsed" />
              <menu-fold-outlined v-else />
            </button>
          </a-tooltip>
          <span class="header-divider" aria-hidden="true"></span>
          <a-breadcrumb>
            <a-breadcrumb-item v-for="(item, index) in breadcrumb" :key="item.name + index">
              <router-link v-if="index === 0 && breadcrumb.length > 1" to="/">{{ item.name }}</router-link>
              <span v-else :class="{ 'is-current': index === breadcrumb.length - 1 }">{{ item.name }}</span>
            </a-breadcrumb-item>
          </a-breadcrumb>
        </div>
        <div class="header-right">
          <MenuSearch />
          <a-tooltip title="帮助中心" placement="bottom">
            <button type="button" class="trigger" aria-label="帮助中心" @click="router.push({ path: '/help', query: { from: route.path } })">
              <question-outlined />
            </button>
          </a-tooltip>
          <a-dropdown trigger="click" @open-change="loadNotifications">
            <button type="button" class="trigger" :aria-label="unread ? `通知（${unread} 条未读）` : '通知'" title="通知">
              <a-badge :count="unread" :offset="[2, -2]" size="small">
                <bell-outlined />
              </a-badge>
            </button>
            <template #overlay>
              <div class="notification-panel">
                <div class="notification-title">
                  <strong>通知</strong>
                  <a-button type="link" size="small" :disabled="unread === 0" @click="readAll">全部已读</a-button>
                </div>
                <div class="notification-list">
                  <div v-if="notificationsLoading" class="notification-state" role="status">通知加载中…</div>
                  <div v-else-if="notificationsFailed" class="notification-state" role="alert">
                    <span>通知加载失败</span>
                    <a-button type="link" size="small" @click="loadNotifications(true)">重试</a-button>
                  </div>
                  <a-empty v-else-if="!notifications.length" :image="null" description="暂无通知" />
                  <button
                    v-for="item in notificationsLoading || notificationsFailed ? [] : notifications"
                    :key="item.id"
                    type="button"
                    class="notification-item"
                    :class="{ 'is-unread': !item.readAt }"
                    @click="readOne(item)"
                  >
                    <span class="ni-head">
                      <span class="ni-title">{{ item.title }}</span>
                      <span class="ni-time">{{ timeAgo(item.createdAt) }}</span>
                    </span>
                    <span class="ni-content">{{ item.content || '' }}</span>
                  </button>
                </div>
                <a-button type="link" block class="notification-more" @click="router.push('/system/notifications')">查看全部</a-button>
              </div>
            </template>
          </a-dropdown>
          <a-tag color="processing">V{{ appVersion }}</a-tag>
          <a-dropdown>
            <button type="button" class="user" aria-label="账号菜单" aria-haspopup="menu">
              <a-avatar :size="24" :src="appStore.userInfo?.avatar || undefined">{{ displayName.charAt(0) }}</a-avatar>
              <span class="user-name">{{ displayName }}</span>
              <down-outlined class="user-caret" />
            </button>
            <template #overlay>
              <a-menu @click="onUserAction">
                <a-menu-item v-if="appStore.helpContact" key="help-contact" disabled>帮助：{{ appStore.helpContact }}</a-menu-item>
                <a-menu-item key="profile">个人中心</a-menu-item>
                <a-menu-divider />
                <a-menu-item key="logout">退出登录</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </a-layout-header>
      <a-layout-content class="main-content"><router-view /></a-layout-content>
    </a-layout>
    <ProfileDrawer v-model:open="profileOpen" />
  </a-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BellOutlined,
  DownOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  QuestionOutlined,
} from '@ant-design/icons-vue'
import { useAppStore } from '@/stores/app'
import { getNotifications, getUnreadCount, markAllRead, markRead, NOTIFICATIONS_CHANGED, type NotificationItem } from '@/api/notifications'
import ProfileDrawer from '@/components/ProfileDrawer.vue'
import BrandMark from '@/components/BrandMark.vue'
import MenuSearch from '@/components/MenuSearch.vue'
import { recordVisit } from '@/composables/useRecentVisits'
import { menuIcon } from '@/utils/menu-icons'
import { APP_VERSION } from '@/version'
import dayjs from 'dayjs'

const appStore = useAppStore()
const route = useRoute()
const router = useRouter()
// 品牌名跟随系统参数 site.name，未加载时回退构建配置
const appName = computed(() => appStore.siteName)
const appVersion = APP_VERSION
const selectedKeys = ref<string[]>([])
const openKeys = ref<string[]>([])
const profileOpen = ref(false)
const unread = ref(0)
const notifications = ref<NotificationItem[]>([])
const notificationsLoading = ref(false)
const notificationsFailed = ref(false)
let notificationsVersion = 0
const displayName = computed(() => appStore.userInfo?.displayName || appStore.userInfo?.username || '用户')


/* ===== 视口：窄屏用覆盖式侧栏，桌面用折叠栏 ===== */
const isMobile = ref(window.matchMedia('(max-width: 768px)').matches)
const mobileOpen = ref(false)
const siderCollapsed = computed(() => (isMobile.value ? false : appStore.sidebarCollapsed))
const triggerLabel = computed(() => {
  if (isMobile.value) return mobileOpen.value ? '关闭导航' : '打开导航'
  return appStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'
})
let mediaQuery: MediaQueryList | null = null
function syncViewport(event: MediaQueryList | MediaQueryListEvent) {
  isMobile.value = event.matches
  if (!event.matches) mobileOpen.value = false
}
function toggleSidebar() {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value
  else appStore.toggleSidebar()
}
// 抽屉打开时锁滚动，避免背景跟随滑动
watch(mobileOpen, (open) => { document.body.style.overflow = open ? 'hidden' : '' })

/* 面包屑补齐模块层级：首页 / 工作协同 / 系统公告 */
const breadcrumb = computed(() => {
  const trail: { name: string }[] = [{ name: '首页' }]
  if (route.path === '/home') return trail
  for (const menu of appStore.menus) {
    if (menu.path === route.path) { trail.push({ name: menu.name }); return trail }
    const child = menu.children?.find((c) => c.path === route.path)
    if (child) { trail.push({ name: menu.name }, { name: child.name }); return trail }
  }
  const title = String(route.meta.title || '')
  if (title && title !== '首页') trail.push({ name: title })
  return trail
})

function syncMenu() {
  selectedKeys.value = [route.path]
  const parent = appStore.menus.find((item: any) => item.children?.some((child: any) => child.path === route.path))
  openKeys.value = parent?.path ? [parent.path] : []
  mobileOpen.value = false
  recordVisit(route.path, String(route.meta.title || ''))
}
function onMenuClick({ key }: { key: string | number }) { if (key !== undefined && key !== null && key !== '') router.push(String(key)) }
let unreadVersion = 0
async function refreshUnread() {
  const version = ++unreadVersion
  try {
    const result = await getUnreadCount()
    if (version === unreadVersion) unread.value = result.count
  } catch { /* 请求层已反馈；失败不把未读数伪装成零 */ }
}
function onNotificationsChanged() { void refreshUnread() }
async function loadNotifications(open: boolean) {
  if (!open) return
  const version = ++notificationsVersion
  notificationsLoading.value = true
  notificationsFailed.value = false
  try {
    const result = await getNotifications({ page: 1, pageSize: 8 })
    if (version === notificationsVersion) notifications.value = result.list
  } catch {
    if (version === notificationsVersion) notificationsFailed.value = true
  } finally {
    if (version === notificationsVersion) notificationsLoading.value = false
  }
  void refreshUnread()
}
async function readOne(item: NotificationItem) {
  // 仍然显示为未读，要关掉重开才变。已读项也无需再发请求。
  if (item.readAt) return
  await markRead(item.id)
  notifications.value = notifications.value.map((n) =>
    n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n,
  )
}

// 面板是窄栏（340px），完整时间戳太占位：按「刚刚 / N 分钟前 / HH:mm / 昨天 HH:mm / MM-DD / 年-月-日」压缩
function timeAgo(v: string) {
  if (!v) return ''
  const d = dayjs(v)
  if (!d.isValid()) return ''
  const mins = dayjs().diff(d, 'minute')
  if (mins >= 0 && mins < 1) return '刚刚'
  if (mins >= 0 && mins < 60) return `${mins} 分钟前`
  if (d.isSame(dayjs(), 'day')) return d.format('HH:mm')
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `昨天 ${d.format('HH:mm')}`
  if (d.isSame(dayjs(), 'year')) return d.format('MM-DD')
  return d.format('YYYY-MM-DD')
}
async function readAll() { await markAllRead(); notifications.value = notifications.value.map((item) => ({ ...item, readAt: new Date().toISOString() })) }
async function onUserAction({ key }: { key: string | number }) {
  if (key === 'profile') profileOpen.value = true
  if (key === 'logout') await appStore.signOut()
}

watch(() => route.path, syncMenu, { immediate: true })
onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 768px)')
  syncViewport(mediaQuery)
  mediaQuery.addEventListener('change', syncViewport)
  window.addEventListener(NOTIFICATIONS_CHANGED, onNotificationsChanged)
  refreshUnread()
})
onBeforeUnmount(() => {
  unreadVersion++
  notificationsVersion++
  window.removeEventListener(NOTIFICATIONS_CHANGED, onNotificationsChanged)
  mediaQuery?.removeEventListener('change', syncViewport)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.app-shell { min-height: 100dvh; background: var(--color-bg-page); }

/* ===== 侧栏 ===== */
.main-sider {
  position: fixed;
  inset: 0 auto 0 0;
  height: 100dvh;
  z-index: 100;
  background: var(--color-surface);
  border-right: var(--rule);
}
.main-sider :deep(.ant-layout-sider-children) { display: flex; flex-direction: column; height: 100%; }
.brand {
  flex: none;
  height: var(--header-h);
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  border: 0;
  border-bottom: var(--rule);
  background: none;
  color: var(--color-text-primary);
  font-family: inherit;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
}
.brand:hover { background: var(--color-layer-01); }
/* 品牌标记裸放：浅色侧栏上彩色渐变即品牌本身，不再垫色块 */
.brand-symbol {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
}
/* 收起态 64px 侧栏只留标记：居中且不裁切宽型 logo（约 32px） */
.main-sider.ant-layout-sider-collapsed .brand { justify-content: center; padding: 0 10px; }
.brand-text { min-width: 0; display: flex; flex-direction: column; }
.brand-text strong { font-size: var(--text-aux); font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.menu-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: var(--space-3) 0; }
.menu-scroll :deep(.ant-menu) { border-inline-end: 0; background: transparent; font-size: var(--text-aux); }
.menu-scroll :deep(.ant-menu-item),
.menu-scroll :deep(.ant-menu-submenu-title) {
  height: 40px;
  line-height: 40px;
  margin-inline: var(--space-2);
  width: calc(100% - var(--space-4));
  border-radius: 0;
  color: var(--color-text-secondary);
}
.menu-scroll :deep(.ant-menu-item:hover),
.menu-scroll :deep(.ant-menu-submenu-title:hover) { color: var(--color-text-primary); background: var(--color-layer-hover); }
/* 选中项整块反白：16:1 对比度，扫一眼就知道自己在哪。 */
.menu-scroll :deep(.ant-menu-item-selected) {
  background: var(--color-primary) !important;
  color: var(--color-text-on-color) !important;
  font-weight: 700;
}
.menu-scroll :deep(.ant-menu-item-selected .anticon) { color: var(--color-text-on-color); }
.menu-scroll :deep(.ant-menu-item-selected)::after { display: none !important; }
.menu-scroll :deep(.ant-menu-item-selected:hover) { background: var(--color-primary-light) !important; color: var(--color-text-on-color) !important; }
.menu-scroll :deep(.ant-menu-submenu-selected > .ant-menu-submenu-title) { color: var(--color-text-primary); font-weight: 700; }
.menu-scroll :deep(.ant-menu-item .anticon),
.menu-scroll :deep(.ant-menu-submenu-title .anticon) { font-size: 15px; }

/* 折叠态：只留图标，居中显示。 */
.menu-scroll :deep(.ant-menu-inline-collapsed) { width: var(--sider-w-collapsed); }
.menu-scroll :deep(.ant-menu-inline-collapsed .ant-menu-title-content) { display: none !important; }
.menu-scroll :deep(.ant-menu-inline-collapsed > .ant-menu-item),
.menu-scroll :deep(.ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title) {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 2px 0;
  width: 100%;
  padding: 0 !important;
}
.menu-scroll :deep(.ant-menu-inline-collapsed .ant-menu-item-icon) { margin: 0 !important; min-width: 0; }
.main-sider.ant-layout-sider-collapsed .brand { justify-content: center; padding: 0; }

/* ===== 主区 ===== */
.main-area { min-height: 100dvh; min-width: 0; margin-left: var(--sider-w); }
.main-area.is-collapsed { margin-left: var(--sider-w-collapsed); }

.header-bar {
  height: var(--header-h);
  padding: 0 var(--space-5);
  background: var(--color-surface);
  border-bottom: var(--rule);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  /* antd 给 Header 注入 line-height: 80px，会沿继承撑高内部行内元素，这里归零 */
  line-height: var(--lh-base);
}
.header-left, .header-right { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.header-left { gap: var(--space-1); }
/* 折叠按钮与面包屑之间加一条细线，避免被读成「返回上一页」。 */
.header-divider { width: 1px; height: 16px; background: var(--color-border-subtle); margin: 0 var(--space-2); flex: none; }
.header-bar .trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--color-text-secondary);
  font-size: var(--text-heading);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.header-bar .trigger:hover { border-color: var(--color-border-subtle); background: var(--color-layer-01); color: var(--color-text-primary); }
.header-bar :deep(.ant-breadcrumb),
.header-bar :deep(.ant-breadcrumb a) { color: var(--color-text-tertiary); font-size: var(--text-aux); }
.header-bar :deep(.ant-breadcrumb a:hover) { color: var(--color-text-primary); }
.header-bar :deep(.ant-breadcrumb-separator) { color: var(--color-text-disabled); }
.header-bar :deep(.ant-breadcrumb .is-current) { color: var(--color-text-primary); font-weight: 500; }
/* 未读数用标准角标，和小铃铛形成固定组合。 */
.header-bar :deep(.ant-badge-count) {
  background: var(--color-primary);
  color: var(--color-text-on-color);
  box-shadow: 0 0 0 1.5px var(--color-surface);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
}
.header-bar .user {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px var(--space-2);
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  font-family: inherit;
  font-size: var(--text-aux);
  cursor: pointer;
}
.header-bar .user:hover { background: var(--color-layer-01); border-color: var(--color-border-subtle); }
.header-bar .user-name { color: var(--color-text-primary); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-bar .user-caret { color: var(--color-text-tertiary); font-size: 12px; }
.header-bar .user :deep(.ant-avatar) { color: var(--color-text-primary); background: var(--color-layer-hover); border: 1px solid var(--color-border-subtle); font-size: var(--text-aux); }
.header-bar :deep(.ant-tag-processing) {
  color: var(--color-text-tertiary);
  background: transparent;
  border-color: var(--color-border-subtle);
  font-size: var(--text-aux);
  margin-inline-end: 0;
  font-variant-numeric: tabular-nums;
}
.main-content { height: calc(100dvh - var(--header-h)); overflow: hidden; min-width: 0; }

/* ===== 通知面板 ===== */
.notification-panel { width: min(380px, calc(100vw - 24px)); background: var(--color-surface); border: var(--rule); display: flex; flex-direction: column; max-height: min(520px, calc(100dvh - 72px)); }
.notification-title { padding: var(--space-3) var(--space-4); display: flex; align-items: center; justify-content: space-between; border-bottom: var(--rule); flex: none; }
.notification-list { min-height: 0; overflow-y: auto; }
.notification-state { display: flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-4); color: var(--color-text-secondary); font-size: var(--text-aux); }
.notification-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-bottom: var(--rule);
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.notification-item:hover { background: var(--color-layer-01); }
/* 未读用左侧实条 + 加粗标题双重标记。 */
.notification-item.is-unread { box-shadow: inset 3px 0 0 var(--color-primary); background: var(--color-layer-01); }
.notification-item .ni-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.notification-item .ni-title { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.notification-item.is-unread .ni-title { color: var(--color-text-primary); font-weight: 700; }
.notification-item .ni-time { flex: none; font-size: var(--text-aux); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.notification-item .ni-content { font-size: var(--text-aux); color: var(--color-text-tertiary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.notification-more { border-top: var(--rule); flex: none; }

.sider-mask { display: none; }

@media (max-width: 768px) {
  .main-area, .main-area.is-collapsed { margin-left: 0; }
  .main-sider {
    width: var(--sider-w) !important;
    min-width: var(--sider-w) !important;
    max-width: var(--sider-w) !important;
    transform: translateX(-100%);
    transition: transform var(--dur-base) var(--ease-out);
    border-right: var(--rule-strong);
  }
  .main-sider.is-mobile-open { transform: none; }
  .sider-mask { display: block; position: fixed; inset: 0; z-index: 99; background: rgba(15, 0, 0, 0.32); }
  .header-bar { padding: 0 var(--space-3); }
  /* 窄屏图标按钮抬到 44px 触摸目标，视觉尺寸靠透明边框补足，不影响排版。 */
  .header-bar .trigger { width: var(--control-h-touch); height: var(--control-h-touch); }
  .header-left, .header-right { gap: var(--space-1); }
  .header-bar :deep(.ant-breadcrumb), .header-bar :deep(.ant-tag) { display: none; }
  .header-divider { display: none; }
  .header-bar .user { padding: 9px 4px; }
  .header-bar .user-caret { display: none; }
  .header-bar .user-name { max-width: 88px; }
  .brand { padding: 0 var(--space-4); }
}
</style>
