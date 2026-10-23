<template>
  <div class="p-0 h-full flex flex-col page-list">

    <div class="shrink-0 pr-4 ml-2.5 pt-2.5">
      <div class="page-head-rule flex items-end justify-between mb-1.5">
        <div>
          <div class="text-xl font-bold text-[#201d1d] leading-none tracking-tight">站内通知</div>
          <div class="text-sm text-[#646262] mt-2">预警 · 提醒</div>
        </div>
      <div class="text-sm text-[#646262]">今日 {{ todayStr }}</div>
      </div>
    </div>

    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <div class="flex justify-between items-center mb-4">
        <a-radio-group v-model:value="filter" button-style="solid">
          <a-radio-button value="unread">未读 {{ unread ?? '—' }}</a-radio-button>
          <a-radio-button value="all">全部</a-radio-button>
        </a-radio-group>
        <a-button @click="handleReadAll">全部已读</a-button>
      </div>

      <a-alert v-if="failed" type="error" message="通知加载失败，请重试" show-icon class="mb-3">
        <template #action><a-button size="small" @click="fetchNotifications">重试</a-button></template>
      </a-alert>
      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="records"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 920 }"
        row-key="id"
        size="small"

      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <div class="flex items-center gap-2 cursor-pointer" @click="handleOpen(record)">
              <span class="w-2 h-2 rounded-full flex-shrink-0" :class="record.readAt ? 'bg-transparent' : 'bg-[#201d1d]'" />
              <span class="table-long-text" :class="record.readAt ? 'text-gray-500' : 'text-[#201d1d] font-medium'">{{ record.title }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'content'">
            <!-- 通知内容为长文本，完整展示并保留换行。 -->
            <span class="text-gray-500 table-long-text">{{ record.content || '-' }}</span>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="typeColor(record.type)">{{ typeLabel(record.type) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'createdAt'">
            {{ formatDateTime(record.createdAt) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <a-tooltip title="标已读"><a-button aria-label="标为已读" class="w-6! h-6! px-0!" type="text" size="small" @click="handleReadOne(record)"><CheckOutlined /></a-button></a-tooltip>
          </template>
        </template>
        <template #emptyText>
          <span v-if="failed">通知未加载，请使用上方重试</span>
          <a-empty v-else description="暂无通知" />
        </template>
      </a-table>
          </div>
    </a-card>

    <ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" />
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import { CheckOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import ListFooter from '@/components/ListFooter.vue'
import { formatDateTime, withEmptyDash } from '@/utils/format'
import { getNotifications, getUnreadCount, markAllRead, markRead, type NotificationItem } from '@/api/notifications'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'
import { useListQuery } from '@/composables/useListQuery'
import { useDict } from '@/composables/useDict'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const unread = ref<number | null>(null)
const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
const columns = withEmptyDash([
  { title: '通知', key: 'title', width: 320 },
  { title: '内容', key: 'content' },
  { title: '类型', key: 'type', width: 100 },
  { title: '时间', key: 'createdAt', width: 160 },
  { title: '操作', key: 'action', width: 50, fixed: 'right' as const },
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
