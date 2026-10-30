<template>
  <Page class="page-list" title="系统公告" description="站点公告的草稿、发布与撤回管理；发布后登录用户可见。">
    <div ref="bodyRef" class="page-body">
      <PageToolbar :show-search="false" :show-create="true" create-label="新建公告" @create="openCreate">
        <!-- 筛选行放进工具栏左区：查询条件与「新建公告」同处一行。 -->
        <template #left>
          <ListFilters :tags="filterTags" :dirty="dirty" :failed="failed" @apply="applyFilters()" @reset="resetFilters" @remove="removeFilter" @retry="fetchList">
            <label class="filter-field">状态<a-select v-model:value="draft.status" :options="statusOptions" allow-clear placeholder="全部状态" style="min-width:150px" /></label>
            <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索标题" allow-clear style="width:220px" @press-enter="onSearchEnter" /></label>
          </ListFilters>
        </template>
      </PageToolbar>
      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="middle"
        :scroll="{ x: 940, y: tableScrollY }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <span class="table-long-text">{{ record.title }}</span>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="statusMeta(record.status).color">{{ statusMeta(record.status).label }}</a-tag>
          </template>
          <template v-if="column.key === 'publishedAt'">
            {{ record.publishedAt ? formatDateTime(record.publishedAt) : '-' }}
          </template>
          <template v-if="column.key === 'updatedAt'">
            {{ formatDateTime(record.updatedAt) }}
          </template>
          <template v-if="column.key === 'action'">
            <a-space :size="0">
              <a-button v-if="record.status === 'draft'" type="link" size="small" @click="openEdit(record as AnnouncementItem)">编辑</a-button>
              <a-button type="link" size="small" @click="openDetail(record as AnnouncementItem)">查看</a-button>
              <a-button v-if="record.status === 'draft' || record.status === 'withdrawn'" type="link" size="small" @click="handlePublish(record as AnnouncementItem)">发布</a-button>
              <a-button v-if="record.status === 'published'" type="link" size="small" @click="handleWithdraw(record as AnnouncementItem)">撤回</a-button>
              <a-popconfirm v-if="record.status !== 'published'" title="确定删除该公告？" ok-text="确定" cancel-text="取消" @confirm="handleDelete(record as AnnouncementItem)">
                <a-button type="link" size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
        <template #emptyText><a-empty :description="failed ? '查询失败，请重试' : hasAppliedFilters ? '没有匹配的公告' : '暂无公告'" /></template>
      </a-table>
    </div>
    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" @change="changePage" @size-change="changePage" />
    </template>
  </Page>

  <a-modal
    :open="editVisible"
    :title="editId ? '编辑公告' : '新建公告'"
    v-bind="modalProps"
    ok-text="保存草稿"
    cancel-text="取消"
    @ok="handleSave"
    @cancel="closeModal"
  >
    <div :ref="feedbackRoot">
      <FormFeedback :items="feedbackSummary" :request-id="feedbackRequestId" @focus="feedback.focus" />
      <a-form layout="vertical">
        <a-form-item label="标题" required data-form-field="title" :validate-status="editErrors.title ? 'error' : undefined">
          <a-input
            v-model:value="editForm.title"
            :disabled="editLoading"
            :maxlength="100"
            aria-label="公告标题"
            placeholder="一句话说明公告主题"
            v-bind="feedback.attrs('title')"
          />
          <p v-if="editErrors.title" :id="feedback.errorId('title')" class="field-error">{{ editErrors.title }}</p>
        </a-form-item>
        <a-form-item label="正文" required data-form-field="content" :validate-status="editErrors.content ? 'error' : undefined">
          <a-textarea
            v-model:value="editForm.content"
            :disabled="editLoading"
            :maxlength="5000"
            :rows="8"
            aria-label="公告正文"
            placeholder="纯文本正文，换行保留展示；发布后登录用户可见"
            v-bind="feedback.attrs('content')"
          />
          <p v-if="editErrors.content" :id="feedback.errorId('content')" class="field-error">{{ editErrors.content }}</p>
        </a-form-item>
        <p class="announcement-note">保存后为草稿，确认无误再发布；已发布内容需先撤回才能编辑。</p>
      </a-form>
    </div>
  </a-modal>

  <AnnouncementDetailModal :open="detailOpen" :announcement-id="detailId" @close="detailOpen = false" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  getAnnouncements, createAnnouncement, updateAnnouncement,
  publishAnnouncement, withdrawAnnouncement, deleteAnnouncement,
  type AnnouncementItem, type AnnouncementStatus,
} from '@/api/announcement'
import { useFormModal } from '@/composables/useFormModal'
import { useListQuery } from '@/composables/useListQuery'
import { useAppStore } from '@/stores/app'
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal.vue'
import FormFeedback from '@/components/FormFeedback.vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFilters from '@/components/ListFilters.vue'
import ListFooter from '@/components/ListFooter.vue'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { formatDateTime } from '@/utils/format'

// ============ 列表页外壳：Page + PageToolbar + ListFooter + 表头固定 ============
const { setTableRef, stickySource } = useListPage()
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

// ============ 列表查询（筛选/分页：返回恢复、账号隔离与迟到保护统一走 useListQuery） ============
interface Filters { status?: AnnouncementStatus; keyword: string }
const filterDefaults = (): Filters => ({ status: undefined, keyword: '' })
const app = useAppStore()
const { draft, applied, dirty, loading, failed, rows: list, total, page, pageSize, refresh: fetchList, apply: applyFilters, reset: resetFilters, changePage, onSearchEnter } = useListQuery<Filters, AnnouncementItem>({
  key: 'system-announcements', account: () => app.userInfo?.id, pageSize: 20,
  defaults: filterDefaults,
  normalize: filters => ({ status: filters.status || undefined, keyword: filters.keyword.trim() }),
  load: query => getAnnouncements({ page: query.page, pageSize: query.pageSize, status: query.status || undefined, keyword: query.keyword || undefined }),
})
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))

const statusOptions: { value: AnnouncementStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'withdrawn', label: '已撤回' },
]

// ============ 已应用筛选的标签与移除（标签文案按页面字段组织） ============
const hasAppliedFilters = computed(() => !!(applied.value.status || applied.value.keyword))
const filterTags = computed(() => [
  ...(applied.value.status ? [{ key: 'status', label: `状态：${statusOptions.find(option => option.value === applied.value.status)?.label ?? applied.value.status}` }] : []),
  ...(applied.value.keyword ? [{ key: 'keyword', label: `关键词：${applied.value.keyword}` }] : []),
])
function removeFilter(key: string) { void applyFilters({ ...applied.value, [key]: key === 'status' ? undefined : '' }) }

const columns = [
  { title: '标题', key: 'title', width: 280 },
  { title: '状态', key: 'status', width: 90 },
  { title: '发布时间', key: 'publishedAt', width: 170 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  { title: '操作', key: 'action', width: 220, fixed: 'right' as const },
]
const { resizeStart } = useResizableColumns('starter-cols-announcements-main-width', ref(columns), { title: 280, status: 90, publishedAt: 170, updatedAt: 170, action: 220 })

function statusMeta(status: AnnouncementStatus) {
  if (status === 'published') return { label: '已发布', color: 'processing' }
  if (status === 'withdrawn') return { label: '已撤回', color: 'default' }
  return { label: '草稿', color: 'warning' }
}

// ============ 新建/编辑 ============
const editModal = useFormModal<{ title: string; content: string }, number>({
  fields: () => ({ title: '标题', content: '正文' }),
  defaults: () => ({ title: '', content: '' }),
  validate: form => ({
    title: form.title.trim() ? '' : '标题不能为空',
    content: form.content.trim() ? '' : '正文不能为空',
  }),
  save: async (form, editId) => {
    if (editId != null) await updateAnnouncement(editId, { title: form.title, content: form.content }, { errorFeedback: 'form' })
    else await createAnnouncement({ title: form.title, content: form.content }, { errorFeedback: 'form' })
    message.success('已保存为草稿')
    void applyFilters()
  },
})
const { visible: editVisible, loading: editLoading, editId, form: editForm, feedback, modalProps, open, close: closeModal, submit: handleSave } = editModal
const feedbackRoot = editModal.bindRoot
const { summary: feedbackSummary, requestId: feedbackRequestId, errors: editErrors } = feedback

function openCreate() { open() }

function openEdit(record: AnnouncementItem) { open(record.id, { title: record.title, content: record.content }) }

// ============ 状态流转 ============
async function handlePublish(record: AnnouncementItem) {
  try {
    await publishAnnouncement(record.id)
    message.success('已发布，登录用户可见')
    await fetchList()
  } catch { /* 拦截器已提示 */ }
}

async function handleWithdraw(record: AnnouncementItem) {
  try {
    await withdrawAnnouncement(record.id)
    message.success('已撤回，登录用户不再可见')
    await fetchList()
  } catch { /* 拦截器已提示 */ }
}

async function handleDelete(record: AnnouncementItem) {
  try {
    await deleteAnnouncement(record.id)
    message.success('删除成功')
    await fetchList()
  } catch { /* 拦截器已提示 */ }
}

// ============ 查看 ============
const detailOpen = ref(false)
const detailId = ref<number | null>(null)
function openDetail(record: AnnouncementItem) {
  detailId.value = record.id
  detailOpen.value = true
}
</script>

<style scoped>
/* 列表滚动链：标题与页脚固定，表体内部滚动（min-height: 0 必须保留）。 */
.page-list .ant-table-wrapper { min-height: 0; }
.announcement-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-aux);
}
</style>
