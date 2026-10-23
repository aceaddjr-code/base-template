<template>
  <Page title="首页" description="从这里进入模块，或继续上次的工作。">
    <div class="home">
      <!-- 唯一深色终端区；账号、入口数量和未读数均来自真实会话。 -->
      <section class="hero">
        <div class="hero-bar">
          <span class="hero-eyebrow">[ 工作台 ]</span>
          <span class="hero-date">{{ todayStr }}</span>
        </div>
        <div class="hero-main">
          <h1>{{ greeting }}，{{ displayName }}</h1>
          <p class="hero-meta">
            <span>{{ roleLabel }}</span>
            <i class="sep" aria-hidden="true"></i>
            <span>{{ deptLabel }}</span>
          </p>
        </div>
        <dl class="hero-stats">
          <div class="stat">
            <dt>可访问模块</dt>
            <dd>{{ moduleCount }}</dd>
          </div>
          <div class="stat">
            <dt>功能入口</dt>
            <dd>{{ entryCount }}</dd>
          </div>
          <button type="button" class="stat stat-link" @click="router.push('/system/notifications')">
            <dt>未读通知</dt>
            <dd>{{ unreadCount ?? '—' }}</dd>
          </button>
        </dl>
      </section>

      <!-- ===== 最新公告：仅展示已发布内容，点击查看详情 ===== -->
      <section v-if="announcements.length" class="block">
        <div class="block-head">
          <h2>最新公告</h2>
          <router-link class="block-action" to="/announcements">查看全部</router-link>
        </div>
        <div class="announcement-list">
          <button v-for="item in announcements" :key="item.id" type="button" class="announcement-item" @click="openAnnouncement(item)">
            <span class="announcement-title">{{ item.title }}</span>
            <span class="announcement-time">{{ formatDateTime(item.publishedAt) }}</span>
          </button>
        </div>
      </section>

      <!-- ===== 最近访问：来自本机记录，按最近使用排序 ===== -->
      <section v-if="recent.length" class="block">
        <div class="block-head">
          <h2>最近访问</h2>
          <button type="button" class="block-action" @click="clearRecentVisits">清空记录</button>
        </div>
        <div class="recent">
          <button v-for="item in recent" :key="item.path" type="button" class="recent-item" @click="router.push(item.path)">
            <span class="recent-title">{{ item.title }}</span>
            <span class="recent-time">{{ timeLabel(item.at) }}</span>
          </button>
        </div>
      </section>

      <!-- ===== 模块入口：直接来自当前账号的菜单权限 ===== -->
      <section class="block">
        <div class="block-head">
          <h2>模块入口</h2>
          <span class="block-note">按当前账号的菜单权限显示</span>
        </div>
        <div v-if="entries.length" class="entries">
          <button v-for="item in entries" :key="item.path" type="button" class="entry" @click="router.push(item.path)">
            <span class="entry-icon"><component :is="menuIcon(item.icon, false)" /></span>
            <span class="entry-body">
              <span class="entry-name">{{ item.name }}</span>
              <span v-if="item.group" class="entry-group">{{ item.group }}</span>
            </span>
            <arrow-right-outlined class="entry-arrow" />
          </button>
        </div>
        <p v-else class="empty">当前账号暂无可见模块，请在「系统管理 → 角色管理」中配置菜单权限。</p>
      </section>

      <!-- ===== 开发者参考：模板说明折叠到底部，不占业务用户的首屏 ===== -->
      <details class="dev-ref">
        <summary>开发者参考（模板说明）</summary>
        <div class="dev-ref-body">
          <section>
            <h3>快速开始</h3>
            <p class="dev-note">复制「示例事项」模块建立第一个业务模块</p>
            <ol class="steps">
              <li v-for="(step, i) in steps" :key="step.title">
                <span class="step-no">{{ String(i + 1).padStart(2, '0') }}</span>
                <div class="step-body">
                  <strong>{{ step.title }}</strong>
                  <span>{{ step.detail }}</span>
                </div>
                <button v-if="step.to" type="button" class="step-link" @click="router.push(step.to)">打开</button>
              </li>
            </ol>
          </section>
          <section>
            <h3>框架能力</h3>
            <ul class="caps">
              <li v-for="cap in capabilities" :key="cap.name">
                <strong>{{ cap.name }}</strong>
                <span>{{ cap.detail }}</span>
              </li>
            </ul>
          </section>
        </div>
      </details>
    </div>
    <AnnouncementDetailModal :open="announcementOpen" :announcement-id="announcementId" @close="announcementOpen = false" />
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRightOutlined } from '@ant-design/icons-vue'
import { useAppStore } from '@/stores/app'
import Page from '@/components/Page.vue'
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal.vue'
import { clearRecentVisits, recentVisits } from '@/composables/useRecentVisits'
import { getUnreadCount } from '@/api/notifications'
import { getPublishedAnnouncements, type AnnouncementBrief } from '@/api/announcement'
import { menuIcon } from '@/utils/menu-icons'
import { formatDateTime } from '@/utils/format'

const router = useRouter()
const appStore = useAppStore()

const displayName = computed(() => appStore.userInfo?.displayName || appStore.userInfo?.username || '开发者')
const roleLabel = computed(() => {
  const info = appStore.userInfo
  const roles = info?.roles?.length ? info.roles : [info?.role || 'user']
  return `角色 ${roles.join(' / ')}`
})
const deptLabel = computed(() => appStore.userInfo?.deptName || '未分配部门')

const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

const recent = computed(() => {
  const allowed = new Set(['/home', '/system/notifications'])
  function collect(menus: typeof appStore.menus, depth = 0) {
    if (depth > 20) return
    for (const menu of menus) {
      if (menu.type === 'button') continue
      if (menu.path) allowed.add(menu.path)
      if (menu.children) collect(menu.children, depth + 1)
    }
  }
  collect(appStore.menus)
  return recentVisits.value.filter(item => allowed.has(item.path))
})
const unreadCount = ref<number | null>(null)

/** 模块入口：只取可跳转的叶子菜单；子项沿用上级图标，避免出现一片相同的文档图标 */
const entries = computed(() => {
  const out: { name: string; path: string; group: string; icon?: string | null }[] = []
  for (const menu of appStore.menus) {
    if (menu.type === 'button') continue
    const children = (menu.children || []).filter((c) => c.type !== 'button')
    if (children.length) {
      for (const child of children) {
        if (child.path) out.push({ name: child.name, path: child.path, group: menu.name, icon: child.icon || menu.icon })
      }
    } else if (menu.path) {
      out.push({ name: menu.name, path: menu.path, group: '', icon: menu.icon })
    }
  }
  return out
})
const moduleCount = computed(() => appStore.menus.filter((m) => m.type !== 'button').length)
const entryCount = computed(() => entries.value.length)

function timeLabel(at: number) {
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(at)
  const today = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

const steps = [
  {
    title: '查看示例模块',
    detail: '列表、筛选、列设置、Excel、表单、详情与数据范围的完整接入方式。',
    to: '/examples/items',
  },
  {
    title: '复制目录并替换命名',
    detail: '实体表名、路由、权限码、scopeKey、菜单、页面存储 key、Excel 列与测试名称。',
  },
  {
    title: '配置菜单与按钮权限',
    detail: '在角色管理中挂上菜单与按钮权限码；使用数据范围的模块需在 scope-form.registry 注册。',
    to: '/system/roles',
  },
  {
    title: '补 SQL 增量补丁并验收',
    detail: '结构变更写入 docs/sql；后端跑 Jest，前端跑 pnpm -C frontend build。',
  },
]

/** 能力清单与代码里的真实实现一一对应，不写模板没做到的事 */
const capabilities = [
  { name: '登录认证', detail: 'JWT 存 httpOnly Cookie，登录态由路由守卫统一回填' },
  { name: '用户与角色', detail: '多角色 + 按钮级权限码（v-access / @RequirePermission）' },
  { name: '菜单权限', detail: '菜单由后端按账号下发，前端动态渲染' },
  { name: '数据范围', detail: '按账号配置可见记录及他人操作开关，需在 scope-form.registry 注册' },
  { name: '列表筛选', detail: '关键词与状态筛选、排序；列偏好和列宽独立持久化' },
  { name: '表单与详情', detail: '新增走纵向表单弹窗，查看与普通编辑共用详情抽屉' },
  { name: 'Excel 导入导出', detail: '按当前筛选或选中导出，列及顺序跟随列设置' },
  { name: '文件上传', detail: '前端图片压缩 + /uploads 静态访问' },
  { name: '审计日志', detail: '关键操作落库留痕，支持多条件查询' },
]

onMounted(async () => {
  try {
    unreadCount.value = (await getUnreadCount()).count
  } catch {
    unreadCount.value = null
  }
  void fetchAnnouncements()
})

// ===== 最新公告：登录用户可读，仅展示已发布内容 =====
const announcements = ref<AnnouncementBrief[]>([])
const announcementOpen = ref(false)
const announcementId = ref<number | null>(null)

async function fetchAnnouncements() {
  try {
    const res = await getPublishedAnnouncements({ page: 1, pageSize: 5 })
    announcements.value = res.list
  } catch {
    announcements.value = []
  }
}

function openAnnouncement(item: AnnouncementBrief) {
  announcementId.value = item.id
  announcementOpen.value = true
}
</script>

<style scoped>
.home {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
  padding-bottom: var(--space-6);
}

/* ===== 最新公告 ===== */
.announcement-list { display: flex; flex-direction: column; }
.announcement-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}
.announcement-item:hover { background: var(--color-layer-01); }
.announcement-title { overflow-wrap: anywhere; }
.announcement-time { color: var(--color-text-tertiary); font-size: var(--text-aux); white-space: nowrap; }

/* ===== 深色终端区：唯一反白面板，用一条标题栏交代身份与时间 ===== */
.hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-5) var(--space-6) var(--space-6);
  background: var(--color-surface-dark);
  color: var(--color-text-on-color);
}
.hero-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border-strong);
}
.hero-eyebrow { font-size: var(--text-aux); color: var(--color-text-disabled); letter-spacing: 0.04em; }
.hero-date { font-size: var(--text-aux); color: var(--color-text-disabled); font-variant-numeric: tabular-nums; }
.hero-main { min-width: 0; }
.hero-main h1 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-display);
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.hero-meta {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: var(--text-aux);
  color: var(--color-text-disabled);
}
.hero-meta .sep { width: 1px; height: 12px; background: var(--color-border-strong); }

/* 数据条：三列等宽 + 竖直细线，读起来像仪表而不是三张卡片。 */
.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-strong);
}
.stat { padding: 0 var(--space-5); border-left: 1px solid var(--color-border-strong); }
.stat:first-child { padding-left: 0; border-left: 0; }
.stat dt { font-size: var(--text-aux); color: var(--color-text-disabled); margin-bottom: var(--space-1); }
.stat dd { margin: 0; font-size: var(--text-display-sm); font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
/* 未读通知可点进收件箱，与其他统计保持同一视觉。 */
.stat-link { border: 0; border-left: 1px solid var(--color-border-strong); background: none; color: inherit; font-family: inherit; text-align: left; cursor: pointer; }
.stat-link:hover dd { text-decoration: underline; text-underline-offset: 4px; }
.stat-link:focus-visible { outline: 2px solid var(--color-text-on-color); outline-offset: 2px; }

/* ===== 内容区 ===== */
.block { background: var(--color-surface); }
.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-bottom: var(--space-3);
  margin-bottom: var(--space-3);
  border-bottom: var(--rule);
}
.block-head h2 { margin: 0; font-size: var(--text-heading); font-weight: 700; color: var(--color-text-primary); }
.block-note { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.block-action { border: 0; background: none; padding: 0; font-family: inherit; font-size: var(--text-aux); color: var(--color-link); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.block-action:hover { color: var(--color-link-hover); }

/* ===== 最近访问 ===== */
.recent { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.recent-item {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--rule);
  border-radius: 4px;
  background: var(--color-surface);
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.recent-item:hover { border-color: var(--color-border-strong); background: var(--color-layer-01); }
.recent-title { font-size: var(--text-aux); color: var(--color-text-primary); font-weight: 500; }
.recent-time { font-size: var(--text-aux); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }

/* ===== 模块入口：图标 + 名称 + 所属模块，不再暴露路由 ===== */
.entries { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: var(--rule);
  border-radius: 4px;
  background: var(--color-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.entry:hover { border-color: var(--color-border-strong); background: var(--color-layer-01); }
.entry:hover .entry-arrow { color: var(--color-text-primary); transform: translateX(2px); }
.entry-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: var(--color-layer-01);
  color: var(--color-text-secondary);
  font-size: 16px;
}
.entry-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.entry-name { font-size: var(--text-body); font-weight: 500; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-group { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.entry-arrow { flex: none; color: var(--color-text-disabled); font-size: 12px; transition: color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.empty { margin: 0; font-size: var(--text-body); color: var(--color-text-tertiary); }

/* ===== 开发者参考：折叠区，默认收起 ===== */
.dev-ref { border-top: var(--rule); padding-top: var(--space-3); }
.dev-ref summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
  cursor: pointer;
  list-style: none;
}
.dev-ref summary::-webkit-details-marker { display: none; }
.dev-ref summary::before { content: '+'; display: inline-block; width: 10px; }
.dev-ref[open] summary::before { content: '−'; }
.dev-ref summary:hover { color: var(--color-text-primary); }
.dev-ref-body { display: flex; flex-direction: column; gap: var(--space-6); padding: var(--space-4) 0 var(--space-2); }
.dev-ref-body h3 { margin: 0; font-size: var(--text-heading); font-weight: 700; color: var(--color-text-primary); }
.dev-note { margin: var(--space-1) 0 var(--space-3); font-size: var(--text-aux); color: var(--color-text-tertiary); }

.steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.steps li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-2);
  margin-inline: calc(-1 * var(--space-2));
  border-bottom: var(--rule);
  transition: background-color var(--dur-fast) var(--ease-out);
}
.steps li:hover { background: var(--color-layer-01); }
.step-no { flex: none; font-size: var(--text-aux); color: var(--color-text-tertiary); padding-top: 2px; font-variant-numeric: tabular-nums; }
.step-body { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; flex: 1; }
.step-body strong { font-size: var(--text-body); font-weight: 500; color: var(--color-text-primary); }
.step-body span { font-size: var(--text-aux); line-height: var(--lh-base); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.step-link {
  flex: none;
  border: 0;
  background: none;
  padding: var(--space-1) 0;
  font-family: inherit;
  font-size: var(--text-aux);
  color: var(--color-link);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.step-link:hover { color: var(--color-link-hover); }

.caps { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--space-5); }
.caps li { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3) 0; border-bottom: var(--rule); min-width: 0; }
.caps li strong { font-size: var(--text-body); font-weight: 500; color: var(--color-text-primary); }
.caps li span { font-size: var(--text-aux); line-height: var(--lh-base); color: var(--color-text-tertiary); overflow-wrap: anywhere; }

@media (max-width: 900px) {
  .home { gap: var(--space-6); }
}
@media (max-width: 640px) {
  .home { gap: var(--space-5); }
  .hero { padding: var(--space-4) var(--space-4) var(--space-5); gap: var(--space-5); }
  .hero-main h1 { font-size: var(--text-display-sm); }
  .hero-stats { padding-top: var(--space-3); }
  .stat { padding: 0 var(--space-3); }
  .stat dd { font-size: var(--text-title); }
  .entries, .caps { grid-template-columns: minmax(0, 1fr); }
  .recent { flex-direction: column; }
  .recent-item { justify-content: space-between; }
}
</style>
