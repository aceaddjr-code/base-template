<template>
  <Page class="page-list" title="数据备份" description="手动备份 · 文件下载">
    <div ref="bodyRef" class="backup-body">
      <PageToolbar :show-search="false">
        <template #actions>
          <!-- 立即备份需要执行中的 loading 反馈，放 actions 插槽而非工具栏默认新增按钮 -->
          <a-button type="primary" :loading="backingUp" @click="handleBackup">立即备份</a-button>
        </template>
      </PageToolbar>

      <!-- 说明卡：备份策略 + 恢复指引 -->
      <div class="backup-guide">
        <div class="flex items-start gap-3">
          <SafetyOutlined class="text-2xl text-primary mt-1" />
          <div class="text-sm guide-text leading-relaxed">
            <div class="font-bold guide-title mb-1">数据库备份</div>
            <div>· 点击立即备份后可查看执行状态，执行期间仍可浏览系统；同一服务进程一次执行一个手动备份。</div>
            <div>· 默认保留 30 天，可由管理员配置；定时执行与异地保存需在部署环境另行配置。</div>
            <div class="mt-2 font-bold guide-title">恢复指引</div>
            <div>· 下载备份后交管理员在隔离数据库验证恢复，再按维护计划操作正式环境；当前页面不提供恢复执行。</div>
            <div>· 数据库备份不包含上传附件，请另行备份附件目录。存在备份文件不代表已经完成恢复验证。</div>
          </div>
        </div>
        <a-alert v-if="backupState.status !== 'idle'" class="mt-3" show-icon
          :type="backupState.status === 'failed' ? 'error' : backupState.status === 'running' ? 'info' : 'success'"
          :message="statusText" />
      </div>

      <a-alert v-if="failed" class="mb-3" type="error" show-icon message="备份列表加载失败">
        <template #action><a-button size="small" @click="fetchData">重试</a-button></template>
      </a-alert>

      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="pagedRecords"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 720, y: tableScrollY }"
        row-key="filename"
        size="middle"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'size'">{{ formatNumber(record.size) }} B</template>
          <template v-if="column.key === 'action'">
            <a-button type="link" size="small" :aria-label="`下载 ${record.filename}`" @click="handleDownload(record.filename)">下载</a-button>
          </template>
        </template>
        <template #emptyText>
          <a-empty :description="failed ? '备份文件未加载，请使用上方重试' : '暂无备份文件，可点击「立即备份」'" />
        </template>
      </a-table>
    </div>
    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" @change="handlePageChange" @size-change="handleSizeChange" />
    </template>
  </Page>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { SafetyOutlined } from '@ant-design/icons-vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import { formatNumber, withEmptyDash } from '@/utils/format'
import { listBackups, createBackup, getBackupStatus, getBackupDownloadUrl, type BackupFile, type BackupStatus } from '@/api/system/backups'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { useResizableColumns } from '@/composables/useResizableColumns'

// 表头固定 + body 内部滚动：高度由容器实测，说明卡与状态提示出现/收起时自动重算。
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

const loading = ref(false)
const failed = ref(false)
const backingUp = ref(false)
const backupState = ref<BackupStatus>({ status: 'idle' })
const statusText = computed(() => backupState.value.status === 'running' ? '备份执行中，可继续浏览系统。服务重启后本次状态不再保留，请检查文件列表。'
  : backupState.value.status === 'failed' ? backupState.value.message || '备份失败，请检查执行配置'
  : `最近备份完成：${backupState.value.result?.filename || ''}`)
let active = true
let statusVersion = 0
let polling: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => { active = false; statusVersion++; clearTimeout(polling) })

async function refreshStatus() {
  const version = ++statusVersion
  clearTimeout(polling)
  try {
    const state = await getBackupStatus()
    if (!active || version !== statusVersion) return
    const wasRunning = backupState.value.status === 'running'
    backupState.value = state
    backingUp.value = state.status === 'running'
    if (wasRunning && state.status !== 'running') await fetchData()
    if (active && version === statusVersion && state.status === 'running') polling = setTimeout(refreshStatus, 2000)
  } catch {
    // 请求层已提示；保留运行态，避免查询失败时允许再次提交。
    if (active && version === statusVersion) polling = setTimeout(refreshStatus, 5000)
  }
}
const records = ref<BackupFile[]>([])
// 翻页/改每页条数对表格毫无作用（本地切片，翻页不触发重新请求，故 useListPage 不传 onChanged）
const { pagination, handlePageChange, handleSizeChange, setTableRef, stickySource } = useListPage()
const pagedRecords = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize
  return records.value.slice(start, start + pagination.pageSize)
})

const columns = withEmptyDash([
  { title: '备份时间', dataIndex: 'date', key: 'date', width: 180 },
  { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true },
  { title: '大小', dataIndex: 'size', key: 'size', width: 120 },
  { title: '操作', key: 'action', width: 70 },
])
const { resizeStart } = useResizableColumns('starter-cols-backups-main-width', ref(columns))

async function fetchData() {
  loading.value = true
  failed.value = false
  try {
    const list = await listBackups()
    records.value = list ?? []
    pagination.total = (list ?? []).length
  } catch {
    // 拦截器已提示；保留旧列表，同时给出显式重试入口覆盖首次加载失败的场景
    failed.value = true
  } finally {
    loading.value = false
  }
}

/** 授权下载：同源 Cookie 随请求携带，临时锚点触发浏览器保存（与附件页同一方式） */
function handleDownload(filename: string) {
  const anchor = document.createElement('a')
  anchor.href = getBackupDownloadUrl(filename)
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function handleBackup() {
  if (backingUp.value) return
  backingUp.value = true
  statusVersion++
  backupState.value = { status: 'running' }
  clearTimeout(polling)
  polling = setTimeout(refreshStatus, 2000)
  try {
    const f = await createBackup()
    if (!active) return
    message.success(`备份完成：${f.filename}`)
    await fetchData()
  } catch { /* 请求层已提示，以下回读实际执行状态，不自动重放写入 */ } finally {
    if (active) { clearTimeout(polling); await refreshStatus() }
  }
}

onMounted(() => { void fetchData(); void refreshStatus() })
</script>

<style scoped>
.backup-body { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--color-surface); }
.backup-body > .ant-table-wrapper { min-height: 0; overflow: hidden; }
/* 说明卡：细线容器加一层浅底。不用 a-card——page-list 下 ant-card-body 会被共享样式去掉内边距 */
.backup-guide { flex-shrink: 0; margin-bottom: var(--space-4); padding: var(--space-4); background: var(--color-layer-01); border: var(--rule); }
.guide-title { color: var(--color-text-primary); }
.guide-text { color: var(--color-text-secondary); }
</style>
