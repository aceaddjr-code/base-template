<template>
  <Page class="page-list" title="操作日志" description="审计留痕 · 多条件筛选">
    <div ref="bodyRef" class="logs-body">
      <PageToolbar :show-search="false">
        <!-- 筛选行放进工具栏左区：查询条件与右侧功能按钮同处一行。 -->
        <template #left>
          <ListFilters :tags="filterTags" :dirty="dirty" :failed="failed" @apply="apply()" @reset="reset" @remove="removeFilter" @retry="fetchLogs">
            <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索用户/模块/描述" allow-clear style="width:220px" @press-enter="onSearchEnter" /></label>
            <label class="filter-field">操作类型<a-select v-model:value="draft.actions" mode="multiple" :options="ACTION_OPTIONS" allow-clear placeholder="全部操作" style="min-width:180px;max-width:300px" /></label>
            <label class="filter-field">操作日期<a-range-picker v-model:value="draft.dates" value-format="YYYY-MM-DD" :presets="filterDatePresets()" style="width:250px" /></label>
            <template #more>
              <label class="filter-field">用户名<a-input v-model:value="draft.username" placeholder="精确匹配用户名" allow-clear style="width:180px" @press-enter="onSearchEnter" /></label>
              <label class="filter-field">模块<a-select v-model:value="draft.entityType" :options="ENTITY_OPTIONS" placeholder="全部模块" allow-clear style="width:210px" /></label>
            </template>
            <template #views><FilterViews module-key="system-logs" :applied="appliedRecord" :sort="sort" :known-fields="['keyword', 'actions', 'dates', 'username', 'entityType']" :date-fields="['dates']" :disabled="loading" @apply-view="onApplyView" /></template>
          </ListFilters>
        </template>
      </PageToolbar>
      <a-table :ref="setTableRef" :columns="columns" :data-source="logList" :loading="loading" :pagination="false" row-key="id" size="middle" :scroll="{ x: 1000, y: tableScrollY }">
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span><span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'createdAt'"><span class="log-time">{{ formatTime(record.createdAt) }}</span></template>
          <template v-else-if="column.key === 'action'"><a-tag :color="ACTION_COLORS(record.action)">{{ actionLabelOf(record.action) }}</a-tag></template>
          <template v-else-if="column.key === 'entityType'">{{ entityTypeLabelOf(record.entityType) }}</template>
          <template v-else-if="column.key === 'entityDesc'">{{ record.entityDesc || (record.entityId ? '#' + record.entityId : '-') }}</template>
          <template v-else-if="column.key === 'detail'">
            <a-tooltip v-if="record.detail" :title="prettyDetail(record.detail)"><span class="detail-text">{{ prettyDetail(record.detail).slice(0, 60) }}</span></a-tooltip><span v-else>-</span>
          </template>
          <template v-else-if="column.key === 'ip'">{{ record.ip || '-' }}</template>
        </template>
        <template #emptyText><a-empty :description="failed ? '查询失败，请重试' : filterTags.length ? '没有匹配的日志' : '暂无日志记录'" /></template>
      </a-table>
    </div>
    <template #footer><ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" /></template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { withEmptyDash, formatDateTime } from '@/utils/format'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import ListFilters from '@/components/ListFilters.vue'
import FilterViews from '@/components/FilterViews.vue'
import { getLogs, type LogItem } from '@/api/logs'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { makeOnApplyView } from '@/composables/useSavedFilterViews'
import { useListPage } from '@/composables/useListPage'
import { useDict } from '@/composables/useDict'
import { useListQuery } from '@/composables/useListQuery'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { filterDatePresets } from '@/utils/filter-dates'
import { useAppStore } from '@/stores/app'

const { setTableRef, stickySource } = useListPage()
const { options: ACTION_OPTIONS, labelOf: actionLabelOf, colorOf: ACTION_COLORS } = useDict('log_action')
const { options: ENTITY_OPTIONS, labelOf: entityTypeLabelOf } = useDict('log_entity_type')
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)
interface Filters { keyword: string; actions: string[]; dates?: [string, string]; username: string; entityType?: string }
const logsFilterDefaults = (): Filters => ({ keyword: '', actions: [], dates: undefined, username: '', entityType: undefined })
const app = useAppStore()
const { draft, applied, dirty, loading, failed, rows: logList, total, page, pageSize, sort, refresh: fetchLogs, apply, reset, changePage, onSearchEnter, totalText } = useListQuery<Filters, LogItem>({
  key: 'system-logs', account: () => app.userInfo?.id, pageSize: 20,
  defaults: logsFilterDefaults,
  normalize: query => ({ keyword: query.keyword.trim(), actions: [...new Set(query.actions)].sort(), dates: query.dates?.length === 2 ? [query.dates[0], query.dates[1]] : undefined, username: query.username.trim(), entityType: query.entityType || undefined }),
  load: (query, signal) => getLogs({ page: query.page, pageSize: query.pageSize, keyword: query.keyword || undefined, action: query.actions.join(',') || undefined, dateFrom: query.dates?.[0], dateTo: query.dates?.[1], username: query.username || undefined, entityType: query.entityType }, signal),
  scrollElement: stickySource,
})
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
const filterTags = computed(() => [
  ...(applied.value.keyword ? [{ key: 'keyword', label: '关键词：' + applied.value.keyword }] : []),
  ...(applied.value.actions.length ? [{ key: 'actions', label: '操作：' + applied.value.actions.map(actionLabelOf).join('、') }] : []),
  ...(applied.value.dates ? [{ key: 'dates', label: '日期：' + applied.value.dates.join(' 至 ') }] : []),
  ...(applied.value.username ? [{ key: 'username', label: '用户名：' + applied.value.username }] : []),
  ...(applied.value.entityType ? [{ key: 'entityType', label: '模块：' + entityTypeLabelOf(applied.value.entityType) }] : []),
])
function removeFilter(key: string) { void apply({ ...applied.value, [key]: key === 'actions' ? [] : key === 'dates' ? undefined : key === 'entityType' ? undefined : '' }) }

// 应用保存的视图：失效字段提示、排序恢复与默认值补齐统一走共享处理器
const onApplyView = makeOnApplyView<Filters>({ sort, apply, defaults: logsFilterDefaults })
const appliedRecord = computed(() => ({ ...applied.value }) as Record<string, unknown>)

const columns = withEmptyDash([
  { title: '时间', key: 'createdAt', dataIndex: 'createdAt', width: 190 },
  { title: '用户', dataIndex: 'username', key: 'username', width: 100 },
  { title: '操作', key: 'action', dataIndex: 'action', width: 90 },
  { title: '模块', key: 'entityType', dataIndex: 'entityType', width: 170 },
  { title: '目标', key: 'entityDesc', dataIndex: 'entityDesc', width: 140 },
  { title: '详情', key: 'detail', dataIndex: 'detail', width: 260 },
  { title: 'IP', key: 'ip', dataIndex: 'ip', width: 120 },
])
const { resizeStart } = useResizableColumns('starter-cols-logs-main-width-v2', ref(columns))
function formatTime(t: string) { return formatDateTime(t) }
const DETAIL_KEY_LABELS: Record<string, string> = {
  name: '名称', displayName: '姓名', username: '用户名', email: '邮箱', phone: '电话', code: '编码', status: '状态', description: '描述', remark: '备注', parentId: '上级', sort: '排序', deptId: '部门', roleId: '角色', leaderId: '直属上级', password: '密码', avatar: '头像', icon: '图标', path: '路径', permission: '权限码', dataScope: '数据范围',
}
function prettyDetail(json: string) {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([key, value]) => [DETAIL_KEY_LABELS[key] ?? key, value])))
    return String(parsed)
  } catch { return json }
}
</script>
<style scoped>
.logs-body { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--color-surface); }
.logs-body > .ant-table-wrapper { min-height: 0; overflow: hidden; }
.detail-text { cursor: help; overflow-wrap: anywhere; }
.log-time { white-space: nowrap; }
</style>
