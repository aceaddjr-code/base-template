<template>
  <div class="p-6 h-full flex flex-col">
    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex justify-between items-center mb-4 gap-3 flex-wrap shrink-0">
          <div class="flex items-center gap-2 flex-wrap">
            <a-radio-group v-model:value="statusFilter" button-style="solid" @change="fetchList(1)">
              <a-radio-button value="">全部</a-radio-button>
              <a-radio-button value="draft">草稿</a-radio-button>
              <a-radio-button value="published">已发布</a-radio-button>
              <a-radio-button value="withdrawn">已撤回</a-radio-button>
            </a-radio-group>
            <a-input
              v-model:value="keyword"
              placeholder="搜索标题"
              allow-clear
              class="w-50"
              aria-label="搜索公告标题"
              @press-enter="fetchList(1)"
            />
            <a-button @click="fetchList(1)">查询</a-button>
          </div>
          <a-button type="primary" @click="openCreate">新建公告</a-button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto">
          <a-table
            :columns="columns"
            :data-source="list"
            :loading="loading"
            :pagination="{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p: number) => fetchList(p),
            }"
            row-key="id"
            size="middle"
            :scroll="{ x: 'max-content' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'title'">
                <span class="announcement-title">{{ record.title }}</span>
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
          </a-table>
        </div>
      </div>
    </a-card>

    <a-modal
      v-model:open="editVisible"
      :title="editId ? '编辑公告' : '新建公告'"
      :confirm-loading="editLoading"
      :mask-closable="!editLoading"
      :keyboard="!editLoading"
      ok-text="保存草稿"
      cancel-text="取消"
      @ok="handleSave"
    >
      <div ref="feedbackRoot">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  getAnnouncements, createAnnouncement, updateAnnouncement,
  publishAnnouncement, withdrawAnnouncement, deleteAnnouncement,
  type AnnouncementItem, type AnnouncementStatus,
} from '@/api/announcement'
import { useFormFeedback } from '@/composables/useFormFeedback'
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal.vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { formatDateTime } from '@/utils/format'

const loading = ref(false)
const list = ref<AnnouncementItem[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const statusFilter = ref<AnnouncementStatus | ''>('')
const keyword = ref('')

const columns = [
  { title: '标题', key: 'title', width: 280 },
  { title: '状态', key: 'status', width: 90 },
  { title: '发布时间', key: 'publishedAt', width: 170 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  { title: '操作', key: 'action', width: 220 },
]

function statusMeta(status: AnnouncementStatus) {
  if (status === 'published') return { label: '已发布', color: 'processing' }
  if (status === 'withdrawn') return { label: '已撤回', color: 'default' }
  return { label: '草稿', color: 'warning' }
}

async function fetchList(targetPage = page.value) {
  loading.value = true
  try {
    const res = await getAnnouncements({
      page: targetPage,
      pageSize,
      status: statusFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
    })
    list.value = res.list
    total.value = res.total
    page.value = res.page
  } catch {
    /* 拦截器已提示，保留旧列表 */
  } finally {
    loading.value = false
  }
}

// ============ 新建/编辑 ============
const editVisible = ref(false)
const editLoading = ref(false)
const editId = ref<number | null>(null)
const editForm = reactive({ title: '', content: '' })
const feedbackRoot = ref<HTMLElement | null>(null)
const feedback = useFormFeedback({
  root: feedbackRoot,
  fields: () => ({ title: '标题', content: '正文' }),
  values: () => ({ ...editForm }),
})
const { summary: feedbackSummary, requestId: feedbackRequestId, errors: editErrors } = feedback

function openCreate() {
  editId.value = null
  editForm.title = ''
  editForm.content = ''
  feedback.clear()
  editVisible.value = true
}

function openEdit(record: AnnouncementItem) {
  editId.value = record.id
  editForm.title = record.title
  editForm.content = record.content
  feedback.clear()
  editVisible.value = true
}

async function handleSave() {
  if (editLoading.value) return
  if (!editForm.title.trim() || !editForm.content.trim()) {
    await feedback.validate({ title: editForm.title.trim() ? '' : '标题不能为空', content: editForm.content.trim() ? '' : '正文不能为空' })
    return
  }
  editLoading.value = true
  try {
    if (editId.value) {
      await updateAnnouncement(editId.value, { title: editForm.title, content: editForm.content }, { errorFeedback: 'form' })
    } else {
      await createAnnouncement({ title: editForm.title, content: editForm.content }, { errorFeedback: 'form' })
    }
    message.success('已保存为草稿')
    editVisible.value = false
    await fetchList(1)
  } catch (error) {
    await feedback.capture(error)
  } finally {
    editLoading.value = false
  }
}

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

onMounted(() => fetchList(1))
</script>

<style scoped>
.announcement-title {
  overflow-wrap: anywhere;
}
.announcement-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 12px;
}
.field-error { margin: 4px 0 0; color: #b42318; }
</style>
