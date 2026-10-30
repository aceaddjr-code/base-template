<template>
  <DetailDrawer ref="drawer" :open="open" title="示例事项详情" :record="detail" :fields="fields" :column="2" :loading="loading" :show-fields="activeTab === 'detail'" editable printable :prepare-print="preparePrint" :preserve-navigation="preserveNavigation" :system-name="appStore.siteName" :save-access="['example-items:update']" :save-handler="save" :reload-handler="reload" @update:open="emit('update:open', $event)" @edit-started="setTab('detail')" @view-mode="setTab('detail')" @saved="onSaved">
    <template #navigation>
      <div class="document-tabs" role="tablist" aria-label="单据详情与履历"><button v-for="tab in tabs" :key="tab.key" role="tab" :aria-selected="activeTab === tab.key" @click="setTab(tab.key)">{{ tab.label }}</button></div>
    </template>
    <template #panel>
      <div v-if="loadError" role="alert">{{ loadError }} <a-button @click="openRecord()">重试</a-button></div>
      <template v-if="detail">
        <ExampleHistoryPanel v-for="tab in historyTabs" v-show="activeTab === tab" :key="`${recordId}-${tab}`" v-bind="{ recordId: detail.id, tab, revision }" :event-id="tab === 'changes' ? focusedEvent : undefined" @locate="locate" @clear-focus="focusedEvent = undefined" />
      </template>
      <div v-if="printError" role="alert">{{ printError }} <a-button v-if="printConflict === 'version'" :disabled="loading" @click="reloadAndPrint">重新加载后打印</a-button> <a-button v-else-if="printConflict === 'intent'" @click="restartPrint">重新发起打印</a-button> <a-button v-else @click="prepareAndRetryPrint">重试同次打印</a-button></div>
    </template>
    <template #before>
      <!-- F06 乐观锁冲突：保留草稿，给出“继续编辑 / 载入最新内容”两个明确出口 -->
      <div v-if="conflict" class="conflict-box" role="alert">
        <a-alert type="warning" show-icon message="保存未生效：记录已被他人修改" description="服务端内容已更新，当前修改仍保留。再次保存前建议先载入最新内容。" />
        <div class="conflict-actions">
          <a-button size="small" :disabled="loading" @click="conflict = false">继续编辑</a-button>
          <a-button size="small" type="primary" :disabled="loading" @click="loadLatest">载入最新内容（放弃当前修改）</a-button>
        </div>
      </div>
    </template>
  </DetailDrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DetailDrawer, { type DetailField } from '@/components/DetailDrawer.vue'
import { accessExample, getExample, updateExample, type ExampleItem, type HistoryTab } from '@/api/example'
import ExampleHistoryPanel from './ExampleHistoryPanel.vue'
import { statusColor, statusLabel, statusOptions } from './example-options'
import { useDict } from '@/composables/useDict'
import { useAppStore } from '@/stores/app'
import type { RouteLocationNormalized } from 'vue-router'

const props = defineProps<{ open: boolean; recordId: number | null; startInEdit?: boolean; tab?: HistoryTab }>()
const emit = defineEmits<{ (event: 'update:open', open: boolean): void; (event: 'updated'): void; (event: 'tab', tab: HistoryTab): void }>()
const appStore = useAppStore()
const drawer = ref<InstanceType<typeof DetailDrawer>>()
const detail = ref<ExampleItem | null>(null)
const loading = ref(false)
const tabs: { key: HistoryTab; label: string }[] = [{ key: 'detail', label: '单据详情' }, { key: 'activity', label: '动态' }, { key: 'operations', label: '操作日志' }, { key: 'changes', label: '修改日志' }]
const activeTab = ref<HistoryTab>('detail'), visited = ref<HistoryTab[]>(['detail']), revision = ref(0), focusedEvent = ref<number>()
const historyTabs = computed(() => visited.value.filter((tab): tab is Exclude<HistoryTab, 'detail'> => tab !== 'detail'))
const loadError = ref(''), printError = ref('')
const printConflict = ref<'' | 'version' | 'intent'>('')
let viewIntent = '', printIntent = '', retryPrint = false, submitted = false, submittedPayload = ''
// getRandomValues 也可用于内网 HTTP 环境，避免依赖仅安全上下文提供的 randomUUID。
function interactionId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') }
function setTab(tab: HistoryTab) { activeTab.value = tab; if (!visited.value.includes(tab)) visited.value.push(tab); emit('tab', tab) }
function locate(id: number) { focusedEvent.value = id; setTab('changes') }
function onSaved() { submitted = false; revision.value++; setTab('detail'); emit('updated') }
function errorText(error: unknown, fallback: string) { return (error as any)?.response?.data?.message || fallback }
function preserveNavigation(to: RouteLocationNormalized, from: RouteLocationNormalized) { return to.path === from.path && Number(to.query.detail) === props.recordId && Number(from.query.detail) === props.recordId }
async function openRecord() {
  const id = props.recordId, generation = ++requestVersion
  if (!props.open || id == null) return
  loading.value = true; loadError.value = ''; detail.value = null
  try {
    const data = await accessExample(id, { action: 'view', interactionId: viewIntent })
    if (generation !== requestVersion || props.recordId !== id || !props.open) return
    detail.value = data.record; loading.value = false; await nextTick()
    if (props.startInEdit) drawer.value?.startEdit()
  } catch (e) { if (generation === requestVersion) loadError.value = errorText(e, '详情加载失败，请重试') }
  finally { if (generation === requestVersion) loading.value = false }
}
async function preparePrint() {
  if (!detail.value) throw new Error('请先加载详情')
  if (!retryPrint || !printIntent) printIntent = interactionId()
  retryPrint = false; printError.value = ''
  try {
    const response = await accessExample(detail.value.id, { action: 'print', interactionId: printIntent, expectedVersion: detail.value.version })
    revision.value++
    return response.record
  } catch (e) {
    printError.value = errorText(e, '打印登记失败，请重试')
    // ID17/ID18：按服务端结构化 reason 分派出口，message 只做展示；未知 409 退回同次重试。
    const failure = (e as { response?: { status?: number; data?: { reason?: string } } })?.response
    printConflict.value = failure?.status !== 409 ? '' : failure.data?.reason === 'version_stale' ? 'version' : failure.data?.reason === 'intent_reused' ? 'intent' : ''
    throw new Error(printError.value)
  }
}
function prepareAndRetryPrint() { retryPrint = true; drawer.value?.printDetail() }
// 版本冲突后重读详情再打印：内容已变，重载后的打印是新意图。
async function reloadAndPrint() {
  printError.value = ''; printConflict.value = ''; printIntent = ''
  try { await reload() } catch { printError.value = '重新加载失败，请重试'; return }
  if (detail.value) void drawer.value?.printDetail()
}
// 意图已被挪用：直接换新意图重试打印，记录本身仍可能是最新的。
function restartPrint() {
  printError.value = ''; printConflict.value = ''; printIntent = ''
  if (detail.value) void drawer.value?.printDetail()
}
// F06:保存与加载时的服务端版本不一致（409）时置位，提示保留草稿或载入最新
const conflict = ref(false)
let requestVersion = 0
const { options: categoryOptions, labelOfAny: categoryLabelOfAny } = useDict('item_category')

// 类别为字典驱动字段（F40）：编辑候选仅启用项;存量停用值回显"名称（已停用）"
const fields = computed((): DetailField[] => [
  { label: '标题', dataIndex: 'title', editable: true, required: true, maxLength: 100 },
  { label: '状态', dataIndex: 'status', valueType: 'tag', tagColor: statusColor, formatter: (record: Record<string, any>) => statusLabel(String(record.status)), editable: true, required: true, inputType: 'select', options: statusOptions },
  { label: '类别', dataIndex: 'category', editable: true, inputType: 'select', options: categoryOptions.value, formatter: (record: Record<string, any>) => categoryLabelOfAny(record.category as string | null | undefined) },
  { label: '说明', dataIndex: 'description', span: 2, editable: true, inputType: 'textarea', maxLength: 500 },
])

async function reload(enterEdit = false) {
  const id = props.recordId
  if (!props.open || id == null) return
  const version = ++requestVersion
  loading.value = true
  try {
    const record = await getExample(id)
    if (version !== requestVersion || !props.open || props.recordId !== id) return
    detail.value = record
    submitted = false
    loading.value = false
    await nextTick()
    if (enterEdit && version === requestVersion && props.open) drawer.value?.startEdit()
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

async function save(payload: Record<string, any>) {
  const id = props.recordId
  const version = requestVersion
  if (!props.open || id == null || !detail.value) throw new Error('请先加载详情')
  // F06:回传加载时的版本，服务端原子条件更新；版本已被推进时返回 409
  // US34:保存请求已提交但回读失败时不重复执行写入——同载荷重试只回读，改了载荷则先核对服务端结果。
  try {
    if (submitted && submittedPayload !== JSON.stringify(payload)) throw Object.assign(new Error('请先核对已提交结果'), { feedbackMessage: '上次保存已提交。请先取消编辑并核对服务端结果，再继续修改；当前输入仍保留。' })
    if (!submitted) {
    await updateExample(id, { ...payload, version: detail.value.version }, { errorFeedback: 'form' })
    submitted = true
    submittedPayload = JSON.stringify(payload)
    revision.value++
    }
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 409) conflict.value = true
    throw error
  }
  conflict.value = false
  // 先取得完整服务端值再替换详情，刷新失败时仍保留当前编辑草稿。
  let record: ExampleItem
  try { record = await getExample(id, { errorFeedback: 'form' }) }
  catch (error) {
    const failure = error as { response?: unknown; requestId?: string }
    throw Object.assign(new Error('详情回读失败'), { response: failure?.response, requestId: failure?.requestId,
      feedbackMessage: '保存已提交，但详情回读失败。请取消编辑后核对服务端结果，当前输入已保留。' })
  }
  if (version !== requestVersion || !props.open || props.recordId !== id) throw new Error('当前详情已切换')
  detail.value = record
}

/** 冲突后载入最新内容：明确放弃当前草稿（按钮文案已声明后果），退出编辑态并重读服务端 */
async function loadLatest() {
  conflict.value = false
  drawer.value?.exitEditToView()
  await reload()
}

watch([() => props.open, () => props.recordId], () => {
  requestVersion++
  detail.value = null
  conflict.value = false
  submitted = false; printIntent = ''; printError.value = ''; printConflict.value = ''; loadError.value = ''; visited.value = ['detail']; focusedEvent.value = undefined
  activeTab.value = props.tab ?? 'detail'; if (!visited.value.includes(activeTab.value)) visited.value.push(activeTab.value)
  viewIntent = interactionId()
  if (props.open && props.recordId != null) void openRecord()
  else loading.value = false
}, { immediate: true })
onBeforeUnmount(() => { requestVersion++ })
watch(() => props.tab, tab => { if (tab && tab !== activeTab.value) setTab(tab) })
defineExpose({ startEdit: () => drawer.value?.startEdit() })
</script>

<style scoped>
/* F06 冲突提示：放在字段区之前，操作按钮随提示成组，窄屏换行。 */
.conflict-box { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-2); }
.conflict-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.document-tabs { display: flex; overflow-x: auto; gap: var(--space-2); margin-bottom: var(--space-3); border-bottom: var(--rule); align-items: center; }
.document-tabs button[role=tab] { flex-shrink: 0; border: 0; border-bottom: 2px solid transparent; padding: var(--space-2); background: transparent; cursor: pointer; }
.document-tabs button[aria-selected=true] { border-bottom-color: var(--color-text-primary); font-weight: 700; }
</style>
