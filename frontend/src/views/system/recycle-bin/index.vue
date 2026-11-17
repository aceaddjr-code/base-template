<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Modal, message } from 'ant-design-vue'
import request from '@/api/request'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFooter from '@/components/ListFooter.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import { useListPage } from '@/composables/useListPage'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { useUserOptions } from '@/composables/useUserOptions'
import { hasAccessByCodes, hasAccessByRoles, hasRecordAction } from '@/utils/access'

interface Row { id: number; docNo: string; title: string; moduleName: string; deletedAt: string; deletedBy: string; state: string; ownerId?: number | null }
interface Detail { record: Record<string, unknown>; state: string; attachments: Array<{id: number; name: string}>; events: Array<{id: number; action: string; actorName: string; occurredAt: string; changes: Array<{id: number; fieldLabel: string; beforeValue: unknown; afterValue: unknown}>}> }
const rows = ref<Row[]>([]), selected = ref<number[]>([]), keyword = ref(''), module = ref<string>(), loading = ref(false), failed = ref(false), busy = ref(false)
const kind = ref<'documents' | 'files'>('documents')
const canRestore = computed(() => hasAccessByRoles('admin') || hasAccessByCodes('recycle-bin:restore'))
const canPurge = computed(() => hasAccessByRoles('admin') || hasAccessByCodes('recycle-bin:purge'))
function canActOnRow(row: Row, action: 'restore' | 'purge') {
  return kind.value === 'documents' ? hasRecordAction(row.ownerId, 'recycle-bin:' + action)
    : action === 'restore' ? canRestore.value : canPurge.value
}
const container = ref<HTMLElement | null>(null), scrollY = useTableScrollY(container)
const { pagination, setTableRef, stickySource, handlePageChange, handleSizeChange } = useListPage(() => { void load() })
const columns = ref([{ title: '模块', key: 'moduleName', dataIndex: 'moduleName', width: 110 }, { title: '单据编号', key: 'docNo', dataIndex: 'docNo', width: 200 }, { title: '标题', key: 'title', dataIndex: 'title' }, { title: '删除人', key: 'deletedBy', dataIndex: 'deletedBy', width: 120 }, { title: '删除时间', key: 'deletedAt', dataIndex: 'deletedAt', width: 190 }, { title: '操作', key: 'action', width: 170 }])
const { resizeStart, isFlexible } = useResizableColumns('recycle-bin-columns-v1', columns, {}, ['title'])
const open = ref(false), detailLoading = ref(false), detailFailed = ref(false), detail = ref<Detail | null>(null), detailId = ref(0)
const fields = [{ label: '单据编号', dataIndex: 'docNo' }, { label: '标题', dataIndex: 'title' }, { label: '负责人 ID', dataIndex: 'ownerId' }, { label: '状态', dataIndex: 'status', formatter: (record: Record<string, unknown>) => ({ pending: '待处理', doing: '进行中', done: '已完成' }[String(record.status)] || String(record.status ?? '-')) }, { label: '类别', dataIndex: 'category' }, { label: '说明', dataIndex: 'description' }, { label: '备注', dataIndex: 'remark' }]
const fileFields = [{ label: '文件名', dataIndex: 'title' }, { label: '来源', dataIndex: 'source' }, { label: '大小（字节）', dataIndex: 'size' }, { label: '删除人', dataIndex: 'deletedBy' }, { label: '删除时间', dataIndex: 'deletedAt', formatter: (record: Record<string, unknown>) => time(String(record.deletedAt)) }]
const labels: Record<string, string> = { create: '创建', update: '修改', delete: '删除', restore: '恢复', view: '查看', print: '打印', no_change: '无变化保存', attachment_upload: '上传附件', attachment_delete: '删除附件' }
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
// 修改日志值渲染：用户编号数组转姓名顿号串（与业务模块修改日志同口径），其余原样展示
const { labelOf, loadUserOptions } = useUserOptions()
onMounted(() => { loadUserOptions() })
const changeValue = (value: unknown) => Array.isArray(value) ? value.map(id => labelOf(Number(id)) || `用户#${id}`).join('、') || '空' : value ?? '空'
let loadToken = 0, detailToken = 0
async function load() {
  const token = ++loadToken
  selected.value = []; loading.value = true; failed.value = false
  try {
    const result = await request.get<never, { list: Row[]; total: number }>(kind.value === 'files' ? '/recycle-bin/files' : '/recycle-bin', { params: { page: pagination.current, pageSize: pagination.pageSize, keyword: keyword.value, ...(kind.value === 'documents' ? { module: module.value } : {}) } })
    if (token !== loadToken) return
    rows.value = result.list; pagination.total = result.total
    if (!result.list.length && pagination.current > 1 && result.total > 0) { pagination.current = Math.ceil(result.total / pagination.pageSize); void load() }
  } catch { if (token === loadToken) { failed.value = true; rows.value = [] } }
  finally { if (token === loadToken) loading.value = false }
}
function search() { pagination.current = 1; void load() }
function switchKind() { selected.value = []; module.value = undefined; keyword.value = ''; open.value = false; detailToken++; search() }
async function view(id: number) {
  const token = ++detailToken
  detailId.value = id; detail.value = null; detailFailed.value = false; open.value = true; detailLoading.value = true
  try { const result = await request.get<never, Detail>(kind.value === 'files' ? `/recycle-bin/files/${id}` : `/recycle-bin/${id}`); if (token === detailToken) detail.value = result }
  catch { if (token === detailToken) detailFailed.value = true }
  finally { if (token === detailToken) detailLoading.value = false }
}
async function act(ids: number[], action: 'restore' | 'purge') {
  if (busy.value || !(action === 'restore' ? canRestore.value : canPurge.value)) return
  const run = async () => {
    busy.value = true
    try {
      const result = await request.post<never, Array<{ id: number; success: boolean; reason?: string }>>(kind.value === 'files' ? '/recycle-bin/files/batch' : '/recycle-bin/batch', { ids, action }, { timeout: 180000 })
      const failures = result.filter(r => !r.success)
      Modal.info({ title: `成功 ${result.length - failures.length} 条，失败 ${failures.length} 条`, content: failures.map(r => `#${r.id}：${r.reason}`).join('；') || '处理完成' })
      if (open.value && ids.includes(detailId.value)) { open.value = false; detailToken++ }
      await load()
    } catch { /* request 提供错误反馈 */ } finally { busy.value = false }
  }
  if (action === 'purge') Modal.confirm({ title: `确认彻底删除选中的 ${ids.length} ${kind.value === 'files' ? '个文件' : '张单据'}？`, content: kind.value === 'files' ? '文件将永久清除，无法恢复。' : '单据内容、履历及附件文件将永久清除，无法恢复。', okText: '彻底删除', okType: 'danger', cancelText: '取消', onOk: run })
  else await run()
}
async function download(file: {id: number; name: string}) {
  try {
    const response = await fetch(`/api/v1/recycle-bin/${detailId.value}/attachments/${file.id}/download`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error('附件下载失败')
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
    link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch { message.error('附件下载失败，请重试') }
}
onMounted(load)
</script>

<template>
  <Page title="回收站" class="page-list">
    <div ref="container" class="recycle-body">
      <a-radio-group v-model:value="kind" button-style="solid" :disabled="busy" @change="switchKind"><a-radio-button value="documents">单据</a-radio-button><a-radio-button value="files">文件</a-radio-button></a-radio-group>
      <div class="toolbar-slot">
        <PageToolbar :show-search="false" :show-create="false" :style="{ visibility: selected.length ? 'hidden' : 'visible' }">
          <template #left>
            <a-input-search v-model:value="keyword" :placeholder="kind === 'files' ? '文件名或所属单据' : '单据编号或标题'" allow-clear :disabled="busy" style="width: 240px; max-width: 100%" @search="search" />
            <a-select v-if="kind === 'documents'" v-model:value="module" placeholder="全部模块" allow-clear :options="[{ value: 'example-items', label: '示例事项' }]" style="min-width: 140px" @change="search" />
            <a-button :disabled="busy" @click="load">刷新</a-button>
          </template>
        </PageToolbar>
        <div v-if="selected.length" class="batch-bar"><span>已选 {{ selected.length }} 条</span><a-button v-if="canRestore" :disabled="busy" @click="act([...selected], 'restore')">恢复</a-button><a-button v-if="canPurge" danger :disabled="busy" @click="act([...selected], 'purge')">彻底删除</a-button><a-button :disabled="busy" @click="selected = []">取消选择</a-button></div>
      </div>
      <a-alert v-if="failed" type="error" message="回收站加载失败"><template #action><a-button @click="load">重试</a-button></template></a-alert>
      <a-table :ref="setTableRef" row-key="id" :columns="columns" :data-source="rows" :loading="loading || busy" :pagination="false" :scroll="{ x: 1000, y: scrollY }" :row-selection="canRestore || canPurge ? { selectedRowKeys: selected, columnWidth: 36, onChange: (keys: (string | number)[]) => selected = keys.map(Number), getCheckboxProps: (record: Row) => ({ disabled: busy || (!canActOnRow(record, 'restore') && !canActOnRow(record, 'purge')) }) } : undefined">
        <template #headerCell="{ column }"><span>{{ kind === 'files' && column.key === 'docNo' ? '所属单据' : kind === 'files' && column.key === 'title' ? '文件名' : column.title }}</span><span v-if="column.key !== 'action' && !isFlexible(String(column.key))" class="resize-handle" @mousedown.stop.prevent="resizeStart(String(column.key), $event)" /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'"><button class="record-title table-long-text" @click="view(record.id)">{{ record.title }}</button><a-tag v-if="record.state === 'purging'">彻底删除待重试</a-tag></template>
          <template v-else-if="column.key === 'deletedAt'">{{ time(record.deletedAt) }}</template>
          <template v-else-if="column.key === 'action'"><a-button v-if="canActOnRow(record as Row, 'restore')" type="link" size="small" :disabled="busy || record.state !== 'deleted'" @click="act([record.id], 'restore')">恢复</a-button><a-button v-if="canActOnRow(record as Row, 'purge')" type="link" size="small" danger :disabled="busy" @click="act([record.id], 'purge')">彻底删除</a-button></template>
        </template>
        <template #emptyText>{{ failed ? '[ 加载失败 ]' : keyword || module ? '[ 没有匹配的记录 ]' : '[ 回收站为空 ]' }}</template>
      </a-table>
    </div>
    <template #footer><ListFooter :source="stickySource" :pagination="pagination" @change="handlePageChange" @size-change="handleSizeChange" /></template>
    <DetailDrawer :open="open" :title="kind === 'files' ? '文件详情' : '回收站单据'" :record="detail?.record" :fields="kind === 'files' ? fileFields : fields" :loading="detailLoading" :show-audit-time="false" @close="open = false; detailToken++">
      <a-alert v-if="detailFailed" type="error" message="详情加载失败"><template #action><a-button @click="view(detailId)">重试</a-button></template></a-alert>
      <template v-if="detail && kind === 'documents'"><h3>附件</h3><div v-if="!detail.attachments.length">[ 暂无附件 ]</div><div v-for="file in detail.attachments" :key="file.id"><a-button type="link" @click="download(file)">{{ file.name }}</a-button></div><h3>履历</h3><a-timeline><a-timeline-item v-for="event in detail.events" :key="event.id">{{ time(event.occurredAt) }} · {{ event.actorName }} · {{ labels[event.action] || event.action }}<div v-for="change in event.changes" :key="change.id">{{ change.fieldLabel }}：{{ changeValue(change.beforeValue) }} → {{ changeValue(change.afterValue) }}</div></a-timeline-item></a-timeline></template>
    </DetailDrawer>
  </Page>
</template>

<style scoped>
.recycle-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.toolbar-slot { position: relative; }
.batch-bar { position: absolute; inset: 0; display: flex; align-items: center; gap: var(--space-3); background: var(--color-layer-hover); border-left: 2px solid var(--color-text); flex-wrap: wrap; }
.record-title { background: transparent; border: 0; color: var(--color-link); font-weight: 600; cursor: pointer; text-align: left; }
.record-title:hover { text-decoration: underline; }
</style>
