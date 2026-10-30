<template>
  <Page class="page-list" title="附件管理" description="私有业务附件：上传后为临时状态，业务记录绑定时引用；过期临时附件由系统按保留期清理。">
    <div class="page-body">
      <!-- 与其他列表页共用 PageToolbar：同一套吸顶与右侧动作区，不再自建一排按钮。 -->
      <PageToolbar :show-search="false" :show-create="false">
        <template #left>
          <a-radio-group v-model:value="draft.status" button-style="solid" @change="apply()">
            <a-radio-button value="">全部</a-radio-button>
            <a-radio-button value="temp">临时</a-radio-button>
            <a-radio-button value="bound">已绑定</a-radio-button>
          </a-radio-group>
        </template>
        <template #actions>
          <a-upload
            :show-upload-list="false"
            :before-upload="handleUpload"
            :disabled="uploading"
          >
            <a-button type="primary" :loading="uploading">上传附件</a-button>
          </a-upload>
          <a-popconfirm title="确认清理所有超过保留期的临时附件？" ok-text="确定" cancel-text="取消" @confirm="handleCleanup">
            <a-button danger :loading="cleaning">清理过期临时</a-button>
          </a-popconfirm>
        </template>
      </PageToolbar>

      <a-alert type="info" show-icon class="mb-3" message="附件存储在服务端私有目录，下载需登录授权；临时附件超过保留期（默认 24 小时）会被自动清理" />

      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="middle"
        :scroll="{ x: 'max-content' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="att-name" :title="record.name">{{ record.name }}</span>
          </template>
          <template v-if="column.key === 'size'">
            {{ formatSize(record.size) }}
          </template>
          <template v-if="column.key === 'status'">
            <a-tag v-if="record.status === 'bound'" color="processing">已绑定<template v-if="record.entityType">：{{ record.entityType }}#{{ record.entityId }}</template></a-tag>
            <a-tag v-else>临时</a-tag>
          </template>
          <template v-if="column.key === 'createdAt'">
            {{ formatDateTime(record.createdAt) }}
          </template>
          <template v-if="column.key === 'action'">
            <a-space :size="0">
              <a-button type="link" size="small" :aria-label="`下载${record.name}`" @click="handleDownload(record as AttachmentItem)">下载</a-button>
              <a-popconfirm title="确定删除该附件？删除后不可恢复。" ok-text="确定" cancel-text="取消" @confirm="handleDelete(record as AttachmentItem)">
                <a-button type="link" size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>
    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" @change="changePage" @size-change="changePage" />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  getAttachments, uploadAttachment, deleteAttachment, cleanupAttachments,
  attachmentDownloadUrl, formatSize, type AttachmentItem, type AttachmentStatus,
} from '@/api/attachment'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import { useListPage } from '@/composables/useListPage'
import { useListQuery } from '@/composables/useListQuery'
import { useAppStore } from '@/stores/app'
import { formatDateTime } from '@/utils/format'

const uploading = ref(false)
const cleaning = ref(false)
// 表格函数 ref 与页脚横滚条来源统一走 useListPage；分页/请求（迟到保护、末页回退）统一走 useListQuery
const { setTableRef, stickySource } = useListPage()
const app = useAppStore()
const { draft, loading, rows: list, page, pageSize, total, refresh: fetchList, apply, changePage } = useListQuery<{ status: AttachmentStatus | '' }, AttachmentItem>({
  key: 'system-attachments', account: () => app.userInfo?.id, pageSize: 20,
  defaults: () => ({ status: '' }),
  normalize: query => ({ status: query.status || '' }),
  load: query => getAttachments({ page: query.page, pageSize: query.pageSize, status: query.status || undefined }),
})
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))

const columns = [
  { title: '文件名', key: 'name', width: 280 },
  { title: '大小', key: 'size', width: 90 },
  { title: '状态', key: 'status', width: 170 },
  { title: '上传时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 140 },
]

async function handleUpload(file: File): Promise<boolean> {
  uploading.value = true
  try {
    await uploadAttachment(file)
    message.success('上传成功，当前为临时附件')
    await apply()
  } catch {
    /* 拦截器已提示 */
  } finally {
    uploading.value = false
  }
  return false
}

function handleDownload(record: AttachmentItem) {
  // 授权下载：Cookie 随请求携带,取回 blob 后触发浏览器保存
  const anchor = document.createElement('a')
  anchor.href = attachmentDownloadUrl(record.id)
  anchor.download = record.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function handleDelete(record: AttachmentItem) {
  try {
    await deleteAttachment(record.id)
    message.success('删除成功')
    await fetchList()
  } catch { /* 拦截器已提示 */ }
}

async function handleCleanup() {
  cleaning.value = true
  try {
    const removed = await cleanupAttachments()
    message.success(removed > 0 ? `已清理 ${removed} 个过期临时附件` : '没有需要清理的过期临时附件')
    await apply()
  } catch { /* 拦截器已提示 */ } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.att-name {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  vertical-align: top;
}
</style>
