<template>
  <div class="p-0 h-full flex flex-col page-list">
    <div class="shrink-0 pr-4 ml-2.5 pt-2.5">

    <div class="page-head-rule flex items-end justify-between mb-1.5">
      <div>
        <div class="text-xl font-bold text-[#201d1d] leading-none tracking-tight">数据备份</div>
        <div class="text-sm text-[#646262] mt-2">手动备份 · 文件下载</div>
      </div>
      <div class="text-sm text-[#646262]">今日 {{ todayStr }}</div>
    </div>
    <!-- 说明卡：备份策略 + 恢复指引 -->
    <a-card :bordered="false" class="mb-4">
      <div class="flex items-start gap-3">
        <safety-outlined class="text-2xl text-[#201d1d] mt-1" />
        <div class="text-sm text-[#424245] leading-relaxed">
          <div class="font-bold text-[#201d1d] mb-1">数据库备份</div>
          <div>· 点击立即备份后可查看执行状态，执行期间仍可浏览系统；同一服务进程一次执行一个手动备份。</div>
          <div>· 默认保留 30 天，可由管理员配置；定时执行与异地保存需在部署环境另行配置。</div>
          <div class="mt-2 font-bold text-[#201d1d]">恢复指引</div>
          <div>· 下载备份后交管理员在隔离数据库验证恢复，再按维护计划操作正式环境；当前页面不提供恢复执行。</div>
          <div>· 数据库备份不包含上传附件，请另行备份附件目录。存在备份文件不代表已经完成恢复验证。</div>
        </div>
      </div>
      <a-alert v-if="backupState.status !== 'idle'" class="mt-3" show-icon
        :type="backupState.status === 'failed' ? 'error' : backupState.status === 'running' ? 'info' : 'success'"
        :message="statusText" />
    </a-card>
    </div>

    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex items-center justify-between shrink-0">
        <span class="font-bold text-[#201d1d]">备份文件</span>
        <a-button type="primary" :loading="backingUp" @click="handleBackup">立即备份</a-button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <a-table
        :ref="setTableRef"
        class="mt-3"
        :columns="columns"
        :data-source="pagedRecords"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 720 }"
        row-key="filename"
        size="small"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'size'">{{ formatNumber(record.size) }} B</template>
          <template v-if="column.key === 'action'">
            <a :href="getBackupDownloadUrl(record.filename)" download>
              <a-tooltip title="下载"><a-button aria-label="下载备份" class="w-6! h-6! px-0!" type="text" size="small"><DownloadOutlined /></a-button></a-tooltip>
            </a>
          </template>
        </template>
      </a-table>
      <a-empty v-if="!records.length && !loading" description="暂无备份文件，可点击「立即备份」" />
      </div>
    </a-card>

    <ListFooter :source="stickySource" :pagination="pagination" @change="handlePageChange" @size-change="handleSizeChange" />
  </div>
</template>

<script lang="ts" setup>
const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ListFooter from '@/components/ListFooter.vue'
import { message } from 'ant-design-vue'
import { SafetyOutlined , DownloadOutlined } from '@ant-design/icons-vue'
import { formatNumber, withEmptyDash } from '@/utils/format'
import { listBackups, createBackup, getBackupStatus, getBackupDownloadUrl, type BackupFile, type BackupStatus } from '@/api/system/backups'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'

const loading = ref(false)
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
  { title: '操作', key: 'action', width: 50 },
])
const { resizeStart } = useResizableColumns('starter-cols-backups-main-width', ref(columns))

async function fetchData() {
  loading.value = true
  try {
    const list = await listBackups()
    records.value = list ?? []
    pagination.total = (list ?? []).length
  } catch { /* 拦截器已提示 */ } finally {
    loading.value = false
  }
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
