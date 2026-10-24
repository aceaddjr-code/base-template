<template>
  <Page class="page-list" title="站内通知" description="预警 · 提醒">
    <div ref="bodyRef" class="notice-body">
      <PageToolbar :show-search="false">
        <template #left>
          <a-radio-group v-model:value="filter" button-style="solid">
            <a-radio-button value="unread">未读 {{ unread ?? '—' }}</a-radio-button>
            <a-radio-button value="all">全部</a-radio-button>
          </a-radio-group>
        </template>
        <template #actions>
          <a-button @click="handleReadAll">全部已读</a-button>
        </template>
      </PageToolbar>

      <a-alert v-if="failed" type="error" message="通知加载失败，请重试" show-icon class="mb-3">
        <template #action><a-button size="small" @click="fetchNotifications">重试</a-button></template>
      </a-alert>
      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="records"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 920, y: tableScrollY }"
        row-key="id"
        size="middle"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <div class="flex items-center gap-2 cursor-pointer" @click="handleOpen(record)">
              <span class="notice-dot" :class="{ 'is-unread': !record.readAt }" />
              <span class="table-long-text notice-text" :class="record.readAt ? 'is-read' : 'is-unread'">{{ record.title }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'content'">
            <!-- 通知内容为长文本，完整展示并保留换行。 -->
            <span class="table-long-text notice-content">{{ record.content || '-' }}</span>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="typeColor(record.type)">{{ typeLabel(record.type) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'createdAt'">
            {{ formatDateTime(record.createdAt) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <!-- 业务状态决定是否允许操作：已读记录不再提供标已读入口 -->
            <a-button v-if="!record.readAt" type="link" size="small" :aria-label="`标为已读：${record.title}`" @click="handleReadOne(record)">标已读</a-button>
            <span v-else class="cell-dash">-</span>
          </template>
        </template>
        <template #emptyText>
          <span v-if="failed">通知未加载，请使用上方重试</span>
          <a-empty v-else description="暂无通知" />
        </template>
      </a-table>
    </div>
    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" />
    </template>
  </Page>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import { formatDateTime, withEmptyDash } from '@/utils/format'
import { getNotifications, getUnreadCount, markAllRead, markRead, type NotificationItem } from '@/api/notifications'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'
import { useListQuery } from '@/composables/useListQuery'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { useDict } from '@/composables/useDict'
import { useAppStore } from '@/stores/app'

// 表头固定 + body 内部滚动：高度由容器实测，失败提示出现/收起时自动重算。
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

const appStore = useAppStore()
const unread = ref<number | null>(null)
const columns = withEmptyDash([
  { title: '通知', key: 'title', width: 320 },
  { title: '内容', key: 'content' },
  { title: '类型', key: 'type', width: 100 },
  { title: '时间', key: 'createdAt', width: 160 },
  { title: '操作', key: 'action', width: 80, fixed: 'right' as const },
])
const { resizeStart } = useResizableColumns('starter-cols-notifications-main-width', ref(columns))

const { labelOf: typeLabel, colorOf: typeColor } = useDict('notification_type')

// ===== 统一列表查询（F36）：读状态即查询条件，标读后回读当前页 =====
interface NotificationFilters { readStatus: 'all' | 'unread' }
const { setTableRef, stickySource } = useListPage()
const { applied, loading, failed, rows: recordsRef, total, page, pageSize, refresh: fetchNotifications, apply, changePage } = useListQuery<NotificationFilters, NotificationItem>({
  key: 'system-notifications', account: () => appStore.userInfo?.id,
  defaults: (): NotificationFilters => ({ readStatus: 'unread' }),
  normalize: query => ({ readStatus: query.readStatus === 'all' ? 'all' : 'unread' }),
  load: (query, signal) => getNotifications({ page: query.page, pageSize: query.pageSize, readStatus: query.readStatus }, signal),
  scrollElement: stickySource,
})
const records = recordsRef
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
const totalText = (count: number) => failed.value ? '数量暂不可用' : `共 ${count} 条`

// 单选按钮即明确查询动作:切换立即应用并回第一页
const filter = computed({
  get: () => applied.value.readStatus,
  set: (value: 'all' | 'unread') => { void apply({ readStatus: value }) },
})

/** 未读角标独立于列表查询；标读动作后一并刷新 */
async function refreshUnread() {
  try {
    unread.value = (await getUnreadCount()).count
  } catch {
    unread.value = null
  }
}

async function afterReadAction(resetPage = false) {
  if (resetPage) page.value = 1
  await Promise.all([fetchNotifications(), refreshUnread()])
}

async function handleOpen(record: any) {
  try {
    if (!record.readAt) await markRead(record.id)
    await afterReadAction()
  } catch { /* 请求层已提示 */ }
}

async function handleReadOne(record: any) {
  try {
    await markRead(record.id)
    message.success('已标为已读')
    await afterReadAction()
  } catch { /* 请求层已提示 */ }
}

async function handleReadAll() {
  try {
    await markAllRead()
    message.success('已全部标为已读')
    await afterReadAction(true)
  } catch { /* 请求层已提示 */ }
}

onMounted(() => { void refreshUnread() })
</script>

<style scoped>
.notice-body { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--color-surface); }
.notice-body > .ant-table-wrapper { min-height: 0; overflow: hidden; }
/* 未读圆点与标题强调色取主题 token，替代原硬编码色值 */
.notice-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.notice-dot.is-unread { background: var(--color-primary); }
.notice-text.is-unread { color: var(--color-text-primary); font-weight: 500; }
.notice-text.is-read { color: var(--color-text-tertiary); }
.notice-content { color: var(--color-text-tertiary); }
</style>
