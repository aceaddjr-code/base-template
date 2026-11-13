<template>
  <Page class="page-list" title="附件管理" description="附件中心：文件库存放直接上传的资料文件；业务附件来自各业务单据，随单据数据范围可见。">
    <div class="page-body">
      <a-tabs v-model:active-key="activeKey" class="att-tabs">
        <a-tab-pane key="library" tab="文件库">
          <!-- 文件库：附件管理直传的独立文件，按附件管理自身数据范围控制。 -->
          <PageToolbar :show-search="false" :show-create="false">
            <template #left>
              <label class="filter-field">文件名<a-input-search v-model:value="libDraft.keyword" placeholder="搜索文件名" allow-clear style="width: 220px" :disabled="libLoading" @search="libApply()" /></label>
            </template>
            <template #actions>
              <a-upload
                v-if="hasAccessByCodes('attachments:upload')"
                :show-upload-list="false"
                :before-upload="handleUpload"
                :disabled="uploading"
              >
                <a-button v-access="['attachments:upload']" type="primary" :loading="uploading">上传附件</a-button>
              </a-upload>
            </template>
          </PageToolbar>

          <a-alert v-if="libFailed" type="error" show-icon class="mb-3" message="文件库列表加载失败，请重试">
            <template #action><a-button size="small" @click="libRefresh">重试</a-button></template>
          </a-alert>

          <a-table
            :ref="lib.setTableRef"
            :columns="libColumns"
            :data-source="libRows"
            :loading="libLoading"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 750 }"
          >
            <template #headerCell="{ column }">
              <span>{{ column.title }}</span>
              <span v-if="column.key !== 'action' && !libIsFlexible(column.key ?? '')" class="resize-handle" @click.stop @mousedown.stop.prevent="libResizeStart(column.key ?? '', $event)" />
            </template>
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span class="att-name" :title="record.name">{{ record.name }}</span>
              </template>
              <template v-else-if="column.key === 'size'">
                {{ formatSize(record.size) }}
              </template>
              <template v-else-if="column.key === 'uploaderName'">
                {{ record.uploaderName || '-' }}
              </template>
              <template v-else-if="column.key === 'createdAt'">
                <span class="att-time">{{ formatDateTime(record.createdAt) }}</span>
              </template>
              <template v-else-if="column.key === 'action'">
                <a-space :size="0">
                  <a-button v-access="['attachments:download']" type="link" size="small" :aria-label="`下载${record.name}`" @click="handleDownload(record as AttachmentItem)">下载</a-button>
                  <a-popconfirm v-if="hasRecordAction(record.ownerId, 'attachments:delete')" title="确定删除该附件？删除后可在回收站恢复。" ok-text="确定" cancel-text="取消" @confirm="handleDelete(record as AttachmentItem)">
                    <a-button type="link" size="small" danger>删除</a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
            <template #emptyText><a-empty :description="libFailed ? '文件库列表未加载' : libApplied.keyword ? '没有匹配的文件' : '暂无文件'" /></template>
          </a-table>
        </a-tab-pane>

        <a-tab-pane key="business" tab="业务附件">
          <!-- 业务附件：各业务表单上传并挂接到单据的文件，可见性跟随单据数据范围。 -->
          <PageToolbar :show-search="false" :show-create="false">
            <template #left>
              <label class="filter-field">文件名<a-input-search v-model:value="bizDraft.keyword" placeholder="搜索文件名或单据" allow-clear style="width: 220px" :disabled="bizLoading" @search="bizApply()" /></label>
              <label class="filter-field">模块<a-select v-model:value="bizDraft.entityType" :options="targetOptions" allow-clear placeholder="全部模块" style="width: 160px" @change="bizApply()" /></label>
              <a-radio-group v-model:value="bizDraft.status" button-style="solid" @change="bizApply()">
                <a-radio-button value="">全部</a-radio-button>
                <a-radio-button value="bound">已挂接</a-radio-button>
                <a-radio-button value="temp">未挂接</a-radio-button>
              </a-radio-group>
            </template>
          </PageToolbar>

          <a-alert v-if="bizFailed" type="error" show-icon class="mb-3" message="业务附件列表加载失败，请重试">
            <template #action><a-button size="small" @click="bizRefresh">重试</a-button></template>
          </a-alert>
          <a-alert v-else type="info" show-icon class="mb-3" message="业务附件请从关联单据管理；已挂接文件可点击关联单据穿透查看，未挂接为上传后未保存到单据的暂存文件。" />

          <a-table
            :ref="biz.setTableRef"
            :columns="bizColumns"
            :data-source="bizRows"
            :loading="bizLoading"
            :pagination="false"
            row-key="id"
            size="middle"
            :scroll="{ x: 1260 }"
          >
            <template #headerCell="{ column }">
              <span>{{ column.title }}</span>
              <span v-if="column.key !== 'action' && !bizIsFlexible(column.key ?? '')" class="resize-handle" @click.stop @mousedown.stop.prevent="bizResizeStart(column.key ?? '', $event)" />
            </template>
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span class="att-name" :title="record.name">{{ record.name }}</span>
              </template>
              <template v-else-if="column.key === 'size'">
                {{ formatSize(record.size) }}
              </template>
              <template v-else-if="column.key === 'entityType'">
                <a-tag v-if="record.entityType">{{ attachmentTargetLabel(record.entityType) }}</a-tag>
                <span v-else>-</span>
              </template>
              <template v-else-if="column.key === 'entity'">
                <template v-if="record.status === 'bound' && record.entityType && record.entityId">
                  <a-button
                    v-if="canDrill(record as AttachmentItem)"
                    type="link"
                    size="small"
                    class="entity-link"
                    :title="`查看${attachmentTargetLabel(record.entityType)}详情`"
                    @click="drillToEntity(record as AttachmentItem)"
                  >{{ record.entityTitle || `#${record.entityId}` }}</a-button>
                  <span v-else :title="noDrillHint(record as AttachmentItem)">{{ record.entityTitle || `#${record.entityId}` }}</span>
                </template>
                <span v-else>-</span>
              </template>
              <template v-else-if="column.key === 'uploaderName'">
                {{ record.uploaderName || '-' }}
              </template>
              <template v-else-if="column.key === 'createdAt'">
                <span class="att-time">{{ formatDateTime(record.createdAt) }}</span>
              </template>
              <template v-else-if="column.key === 'status'">
                <a-tag v-if="record.status === 'bound'" color="processing">已挂接</a-tag>
                <a-tag v-else>未挂接</a-tag>
              </template>
              <template v-else-if="column.key === 'action'">
                <a-space :size="0">
                  <a-button v-if="canDownloadBusiness(record as AttachmentItem)" type="link" size="small" :aria-label="`下载${record.name}`" @click="handleDownload(record as AttachmentItem)">下载</a-button>
                  <!-- 已挂接文件由单据详情管理；这里只允许清理自己上传的未挂接暂存文件。 -->
                  <a-popconfirm
                    v-if="record.status === 'temp' && record.mine"
                    title="该文件尚未挂接任何单据，确定删除？" ok-text="确定" cancel-text="取消"
                    @confirm="handleDelete(record as AttachmentItem)"
                  >
                    <a-button v-access="['attachments:delete']" type="link" size="small" danger>删除</a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
            <template #emptyText><a-empty :description="bizFailed ? '业务附件列表未加载' : bizApplied.keyword || bizApplied.status || bizApplied.entityType ? '没有匹配的业务附件' : '暂无业务附件'" /></template>
          </a-table>
        </a-tab-pane>
      </a-tabs>
    </div>
    <template #footer>
      <ListFooter :source="activeStickySource" :pagination="pagination" :total-text="activeTotalText" @change="changeActivePage" @size-change="changeActivePage" />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import {
  getAttachments, uploadAttachment, deleteAttachment,
  attachmentDownloadUrl, formatSize, ATTACHMENT_MAX_SIZE, type AttachmentItem, type AttachmentStatus,
} from '@/api/attachment'
import { ATTACHMENT_TARGET_META, attachmentTargetLabel, type AttachmentTargetMeta } from '@/constants/attachment-targets'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import { useListPage } from '@/composables/useListPage'
import { useListQuery } from '@/composables/useListQuery'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useAppStore } from '@/stores/app'
import { formatDateTime } from '@/utils/format'
import { hasAccessByCodes, hasRecordAction } from '@/utils/access'

const router = useRouter()
const activeKey = ref<'library' | 'business'>('library')
const uploading = ref(false)
// 表格函数 ref 与页脚横滚条来源统一走 useListPage；两个页签各持一份，页脚取当前激活页
const lib = useListPage()
const biz = useListPage()
const app = useAppStore()

function canDownloadBusiness(record: AttachmentItem) {
  if (record.status !== 'bound') return hasAccessByCodes('attachments:download')
  const code = record.entityType ? ATTACHMENT_TARGET_META[record.entityType]?.accessCode : undefined
  return !!code && hasAccessByCodes(code)
}

const { draft: libDraft, applied: libApplied, loading: libLoading, failed: libFailed, rows: libRows, page: libPage, pageSize: libPageSize, total: libTotal, refresh: libRefresh, apply: libApply, changePage: changeLibPage, totalText: libTotalText } = useListQuery<{ keyword: string }, AttachmentItem>({
  key: 'system-attachments-library', account: () => app.userInfo?.id, pageSize: 20,
  defaults: () => ({ keyword: '' }),
  normalize: query => ({ keyword: query.keyword.trim() }),
  load: (query, signal) => getAttachments({ page: query.page, pageSize: query.pageSize, origin: 'center', keyword: query.keyword || undefined }, signal),
})
const { draft: bizDraft, applied: bizApplied, loading: bizLoading, failed: bizFailed, rows: bizRows, page: bizPage, pageSize: bizPageSize, total: bizTotal, refresh: bizRefresh, apply: bizApply, changePage: changeBizPage, totalText: bizTotalText } = useListQuery<{ keyword: string; status: AttachmentStatus | ''; entityType: string }, AttachmentItem>({
  key: 'system-attachments-business', account: () => app.userInfo?.id, pageSize: 20,
  defaults: () => ({ keyword: '', status: '', entityType: '' }),
  normalize: query => ({ keyword: query.keyword.trim(), status: query.status || '', entityType: query.entityType || '' }),
  load: (query, signal) => getAttachments({ page: query.page, pageSize: query.pageSize, origin: 'business', status: query.status || undefined, entityType: query.entityType || undefined, keyword: query.keyword || undefined }, signal),
})

// 两页签列不同，列宽存储 key 也分开；文件名列做弹性列吸收剩余宽度。
const libColumns = ref([
  { title: '文件名', key: 'name' },
  { title: '大小', key: 'size', width: 90 },
  { title: '上传人', key: 'uploaderName', width: 130 },
  { title: '上传时间', key: 'createdAt', width: 190 },
  { title: '操作', key: 'action', width: 140 },
])
const { resizeStart: libResizeStart, isFlexible: libIsFlexible } = useResizableColumns('system-attachments-library-widths-v2', libColumns, { size: 90, uploaderName: 130, createdAt: 190, action: 140 }, ['name'])
const bizColumns = ref([
  { title: '文件名', key: 'name' },
  { title: '大小', key: 'size', width: 90 },
  { title: '所属模块', key: 'entityType', width: 120 },
  { title: '关联单据', key: 'entity', width: 220 },
  { title: '上传人', key: 'uploaderName', width: 130 },
  { title: '上传时间', key: 'createdAt', width: 190 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 150 },
])
const { resizeStart: bizResizeStart, isFlexible: bizIsFlexible } = useResizableColumns('system-attachments-business-widths-v2', bizColumns, { size: 90, entityType: 120, entity: 220, uploaderName: 130, createdAt: 190, status: 100, action: 150 }, ['name'])

/** 模块筛选项来自前端业务注册表；未登记类型仍会出现在列表（显示技术标识），但不在筛选项中 */
const targetOptions = Object.entries(ATTACHMENT_TARGET_META).map(([value, meta]) => ({ value, label: meta.label }))

const pagination = computed(() => activeKey.value === 'library'
  ? { current: libPage.value, pageSize: libPageSize.value, total: libTotal.value }
  : { current: bizPage.value, pageSize: bizPageSize.value, total: bizTotal.value })
const activeTotalText = computed(() => (activeKey.value === 'library' ? libTotalText.value : bizTotalText.value))
const activeStickySource = () => (activeKey.value === 'library' ? lib.stickySource() : biz.stickySource())
function changeActivePage(page: number, pageSize: number) {
  if (activeKey.value === 'library') changeLibPage(page, pageSize)
  else changeBizPage(page, pageSize)
}

/** 穿透条件：来源已登记且具备目标模块查看权限；未登记来源只能看技术标识 */
function targetMeta(record: AttachmentItem): AttachmentTargetMeta | null {
  return record.entityType ? ATTACHMENT_TARGET_META[record.entityType] ?? null : null
}
function canDrill(record: AttachmentItem): boolean {
  const meta = targetMeta(record)
  if (!meta) return false
  return !meta.accessCode || hasAccessByCodes(meta.accessCode)
}
function noDrillHint(record: AttachmentItem): string {
  const meta = targetMeta(record)
  if (!meta) return '未登记的来源类型，请联系管理员核对'
  return `需要${attachmentTargetLabel(record.entityType)}查看权限`
}
function drillToEntity(record: AttachmentItem) {
  const meta = targetMeta(record)
  if (!meta || record.entityId == null) return
  router.push({ path: meta.path, query: { detail: String(record.entityId), ...(meta.tab ? { tab: meta.tab } : {}) } })
}

async function handleUpload(file: File): Promise<boolean> {
  if (!file.size || file.size > ATTACHMENT_MAX_SIZE) { message.error('文件必须非空且不超过 500MB'); return false }
  uploading.value = true
  try {
    await uploadAttachment(file)
    message.success('已上传到文件库')
    await libApply()
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
    if (activeKey.value === 'library') await libRefresh()
    else await bizRefresh()
  } catch { /* 拦截器已提示 */ }
}

</script>

<style scoped>
/* Hallmark · app screen · modern-minimal · existing project theme · attachment management */
/* Critique: keep file actions and source records legible at desktop and narrow widths. */
.att-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 0;
}
.att-tabs :deep(.ant-btn:focus-visible),
.att-tabs :deep(.ant-input:focus-visible),
.att-tabs :deep(.ant-select-selector:focus-visible) {
  outline: var(--focus-width) solid var(--color-link);
  outline-offset: var(--focus-offset);
}
.att-tabs :deep(.ant-btn:active:not(:disabled)) { opacity: .85; }
.att-name {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.entity-link {
  padding-inline: 0;
  height: auto;
  white-space: normal;
  text-align: left;
  overflow-wrap: anywhere;
}
.att-time { white-space: nowrap; }
.filter-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  white-space: nowrap;
}
@media (max-width: 768px) {
  .filter-field { flex: 1 1 100%; }
  .filter-field :deep(.ant-input-search) { flex: 1; min-width: 0; width: auto !important; }
}
</style>
