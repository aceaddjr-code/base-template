<template>
  <Page class="page-list" title="示例事项" description="展示列表、筛选、列设置、Excel、表单、详情和数据范围的完整接入方式。">
    <div ref="bodyRef" class="page-body">
      <PageToolbar
        :show-search="false"
        :show-create="true"
        :menu-items="['import', 'export', 'columns']"
        search-placeholder="搜索标题或说明"
        :columns="columns"
        :all-columns="allColumns"
        column-settings-key="starter-example-columns"
        :resizable="exampleResizable"
        :locked-keys="['actions']"
        :create-access="['example-items:create']"
        :import-access="['example-items:import']"
        :export-access="['example-items:export']"
        :import-precheck="precheckExamples"
        :import-confirm="importExamples"
        :import-template-url="exampleImportTemplateUrl"
        :export-url="exportUrl"
        @create="openCreate"
        @imported="onImported"
        @update:columns="columns = $event"
      />
      <ListFilters :tags="filterTags" :total="pagination.total" :dirty="dirty" :loading="loading" :failed="failed" @apply="apply()" @reset="reset" @remove="removeFilter" @retry="fetchRows">
        <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索标题或说明" allow-clear style="width:220px" @press-enter="onSearchEnter" /></label>
        <label class="filter-field">状态<a-select v-model:value="draft.statuses" mode="multiple" :options="statusOptions" allow-clear placeholder="全部状态" style="min-width:180px;max-width:300px" /></label>
        <label class="filter-field">更新时间<a-range-picker v-model:value="draft.updated" value-format="YYYY-MM-DD" :presets="filterDatePresets()" style="width:250px" /></label>
        <template #more><label class="filter-field">创建时间<a-range-picker v-model:value="draft.created" value-format="YYYY-MM-DD" :presets="filterDatePresets()" style="width:250px" /></label></template>
        <template #views><FilterViews module-key="example-items" :applied="appliedRecord" :sort="sort" :known-fields="['keyword', 'statuses', 'updated', 'created']" :date-fields="['updated', 'created']" :disabled="loading" @apply-view="onApplyView" /></template>
      </ListFilters>
      <div v-if="selectedIds.length" class="batch-bar">
        <span class="batch-count">已选 <strong>{{ selectedIds.length }}</strong> 条（当前页）</span>
        <a-button v-access="['example-items:export']" size="small" :disabled="batchSaving" @click="exportSelected">导出选中</a-button>
        <a-popconfirm :title="`确认删除选中的 ${selectedIds.length} 条记录？每条独立处理，失败会给出原因。`" ok-text="确认删除" cancel-text="取消" :disabled="batchSaving" @confirm="removeSelected">
          <a-button v-access="['example-items:delete']" size="small" danger :loading="batchSaving">批量删除</a-button>
        </a-popconfirm>
        <a-button size="small" type="link" :disabled="batchSaving" @click="selectedIds = []">取消选择</a-button>
      </div>
      <a-table :ref="setTableRef" :columns="tableColumns" :data-source="rows" :loading="loading" :row-selection="rowSelection" row-key="id" :pagination="false" :scroll="{ x: 900, y: tableScrollY }" size="middle" @change="changeTable">
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span v-if="column.key !== 'actions'" class="resize-handle" @click.stop @mousedown.stop.prevent="resizeStart(column.key ?? '', $event)" />
        </template>
        <template #bodyCell="{ column, record }">
          <!-- 标题允许长内容换行，同时保留按钮的详情入口和键盘操作。 -->
          <template v-if="column.key === 'title'"><button type="button" class="row-title" :class="{ 'cell-dash': !record.title }" @click="openDetail(Number(record.id))">{{ record.title || '-' }}</button></template>
          <template v-else-if="column.key === 'status'"><a-tag class="status-tag" :class="`is-${record.status}`">{{ statusLabel(record.status) }}</a-tag></template>
          <template v-else-if="column.key === 'category'"><span>{{ categoryLabelOfAny(record.category) }}</span></template>
          <!-- 说明为自由长文本：完整换行，保留用户输入的换行符。 -->
          <template v-else-if="column.key === 'description'"><span class="table-long-text">{{ record.description || '-' }}</span></template>
          <template v-else-if="column.key === 'updatedAt'"><span class="table-meta">{{ formatDateTime(record.updatedAt) }}</span></template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button v-access="['example-items:update']" type="link" size="small" @click="openDetail(Number(record.id), true)">编辑</a-button>
              <a-popconfirm title="确定删除这条示例数据？" @confirm="remove(Number(record.id))"><a-button v-access="['example-items:delete']" type="link" danger size="small">删除</a-button></a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>
    <template #footer><ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" /></template>
  </Page>

  <a-modal :open="modalVisible" title="新增示例事项" v-bind="modalProps" ok-text="保存" cancel-text="取消" @ok="save" @cancel="closeCreate">
    <div :ref="createFeedbackRoot">
    <FormFeedback :items="createFeedbackItems" :request-id="createRequestId" @focus="createFeedback.focus" />
    <a-form layout="vertical">
      <a-form-item label="标题" required data-form-field="title" :validate-status="createErrors.title ? 'error' : undefined"><a-input v-model:value="form.title" aria-label="标题" v-bind="createFeedback.attrs('title')" :disabled="modalLoading" :maxlength="100" /><p v-if="createErrors.title" :id="createFeedback.errorId('title')" class="field-error">{{ createErrors.title }}</p></a-form-item>
      <a-form-item label="状态" data-form-field="status" :validate-status="createErrors.status ? 'error' : undefined"><a-select v-model:value="form.status" aria-label="状态" v-bind="createFeedback.attrs('status')" :disabled="modalLoading" :options="statusOptions" /><p v-if="createErrors.status" :id="createFeedback.errorId('status')" class="field-error">{{ createErrors.status }}</p></a-form-item>
      <a-form-item label="类别" data-form-field="category" :validate-status="createErrors.category ? 'error' : undefined"><a-select v-model:value="form.category" aria-label="类别" v-bind="createFeedback.attrs('category')" :disabled="modalLoading" :options="categoryOptions" allow-clear placeholder="选填" /><p v-if="createErrors.category" :id="createFeedback.errorId('category')" class="field-error">{{ createErrors.category }}</p></a-form-item>
      <a-form-item label="说明" data-form-field="description" :validate-status="createErrors.description ? 'error' : undefined"><a-textarea v-model:value="form.description" aria-label="说明" v-bind="createFeedback.attrs('description')" :disabled="modalLoading" :rows="4" :maxlength="500" show-count /><p v-if="createErrors.description" :id="createFeedback.errorId('description')" class="field-error">{{ createErrors.description }}</p></a-form-item>
    </a-form>
    </div>
  </a-modal>

  <ExampleDetailDrawer v-model:open="detailOpen" :record-id="detailId" :start-in-edit="detailEditRequested" @updated="fetchRows" />
  <a-modal v-model:open="batchResultOpen" title="批量删除结果" :footer="null" width="560px">
    <template v-if="batchUnknown">
      <a-alert type="warning" show-icon message="结果待确认" description="请求没有返回逐条结果（网络中断或服务端异常），无法判断哪些记录已删除。请刷新列表核对后再决定是否重新勾选删除，未知项不作为失败清单重试。" />
      <div class="batch-actions"><a-button size="small" type="primary" @click="batchResultOpen = false">知道了</a-button></div>
    </template>
    <template v-else>
      <a-alert :type="batchResult.failures.length ? 'warning' : 'success'" show-icon :message="`成功 ${batchResult.successCount}/${batchResult.total} 条，失败 ${batchResult.failures.length} 条`" />
      <ul v-if="batchResult.failures.length" class="batch-failures"><li v-for="failure in batchResult.failures" :key="failure.id">记录 #{{ failure.id }}：{{ failure.reason }}</li></ul>
      <div v-if="batchResult.failures.length" class="batch-actions">
        <a-button v-access="['example-items:delete']" size="small" type="primary" :loading="batchSaving" @click="retryFailed">仅重试失败的 {{ batchResult.failures.length }} 条</a-button>
        <a-button size="small" :disabled="batchSaving" @click="copyFailures">复制失败原因</a-button>
        <a-button size="small" :disabled="batchSaving" @click="downloadFailures">下载失败明细</a-button>
      </div>
      <p v-else-if="batchResult.total" class="batch-done-note">本次批次已全部处理完成。</p>
    </template>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { formatDateTime } from '@/utils/format'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFilters from '@/components/ListFilters.vue'
import FilterViews from '@/components/FilterViews.vue'
import { useListQuery } from '@/composables/useListQuery'
import { filterDatePresets } from '@/utils/filter-dates'
import { useAppStore } from '@/stores/app'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
import ListFooter from '@/components/ListFooter.vue'
import ExampleDetailDrawer from './ExampleDetailDrawer.vue'
import { statusOptions, statusLabel } from './example-options'
import { useDict } from '@/composables/useDict'
import { makeOnApplyView } from '@/composables/useSavedFilterViews'
import { useDetailDeepLink } from '@/composables/useDetailDeepLink'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { downloadCsv } from '@/utils/csv-download'
import { batchDeleteExamples, createExample, deleteExample, exampleImportTemplateUrl, getExampleExportUrl, importExamples, listExamples, precheckExamples, type ExampleBatchResult, type ExampleItem, type ExampleListQuery } from '@/api/example'

// 表头固定 + body 内部滚动：高度由容器实测，工具栏换行时自动重算。
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)
const detailOpen = ref(false)
const detailId = ref<number | null>(null)
const detailEditRequested = ref(false)
const selectedIds = ref<number[]>([])
const batchSaving = ref(false)
const batchResultOpen = ref(false)
const batchResult = ref<ExampleBatchResult>({ successCount: 0, total: 0, failures: [] })
// F37:请求未返回逐条结果(网络中断/服务端 5xx)时结果未知,不能当作失败清单开放重试
const batchUnknown = ref(false)
interface Filters { keyword: string; statuses: string[]; updated?: [string, string]; created?: [string, string] }
const exampleFilterDefaults = (): Filters => ({ keyword: '', statuses: [], updated: undefined, created: undefined })
const app = useAppStore()

// 类别为字典驱动字段（F40）：新增/编辑候选仅启用项;存量停用值回显"名称（已停用）"
const { options: categoryOptions, labelOfAny: categoryLabelOfAny } = useDict('item_category')
const { setTableRef, stickySource } = useListPage()
const { draft, applied, dirty, loading, failed, rows, total, page, pageSize, sort, activeQuery: filterSnapshot, refresh: fetchRows, apply, reset, changePage, changeSort, onSearchEnter, totalText } = useListQuery<Filters, ExampleItem>({
  key: 'example-items', account: () => app.userInfo?.id,
  defaults: exampleFilterDefaults,
  normalize: query => ({ keyword: query.keyword.trim(), statuses: [...new Set(query.statuses)].sort(), updated: query.updated?.length === 2 ? [query.updated[0], query.updated[1]] : undefined, created: query.created?.length === 2 ? [query.created[0], query.created[1]] : undefined }),
  load: (query, signal) => listExamples({ ...toApiQuery(query), sortBy: query.sortBy, sortOrder: query.sortOrder, page: query.page, pageSize: query.pageSize }, signal),
  scrollElement: stickySource,
  onQueryChanged: () => { selectedIds.value = [] },
})
function toApiQuery(query: Filters): ExampleListQuery {
  return { keyword: query.keyword || undefined, status: query.statuses.join(',') || undefined, updatedAtFrom: query.updated?.[0], updatedAtTo: query.updated?.[1], createdAtFrom: query.created?.[0], createdAtTo: query.created?.[1] }
}
const activeQuery = computed(() => ({ ...toApiQuery(filterSnapshot.value), ...sort.value }))
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
const filterTags = computed(() => [
  ...(applied.value.keyword ? [{ key: 'keyword', label: `关键词：${applied.value.keyword}` }] : []),
  ...(applied.value.statuses.length ? [{ key: 'statuses', label: `状态：${applied.value.statuses.map(statusLabel).join('、')}` }] : []),
  ...(applied.value.updated ? [{ key: 'updated', label: `更新时间：${applied.value.updated.join(' 至 ')}` }] : []),
  ...(applied.value.created ? [{ key: 'created', label: `创建时间：${applied.value.created.join(' 至 ')}` }] : []),
])
function removeFilter(key: string) { void apply({ ...applied.value, [key]: key === 'keyword' ? '' : key === 'statuses' ? [] : undefined }) }
const exampleResizable = computed(() => ({ colWidths, setColumnWidth }))

// 应用保存的视图：失效字段提示、排序恢复与默认值补齐统一走共享处理器
const onApplyView = makeOnApplyView<Filters>({ sort, apply, defaults: exampleFilterDefaults })
const appliedRecord = computed(() => ({ ...applied.value }) as Record<string, unknown>)
const rowSelection = computed(() => ({ selectedRowKeys: selectedIds.value, onChange: (keys: (string | number)[]) => { selectedIds.value = keys.map(Number) }, getCheckboxProps: () => ({ disabled: batchSaving.value }) }))
const allColumns = ref([
  { title: '标题', dataIndex: 'title', key: 'title', width: 220, sorter: true },
  { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
  { title: '类别', dataIndex: 'category', key: 'category', width: 130 },
  { title: '说明', dataIndex: 'description', key: 'description' },
  { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 180, sorter: true, customRender: ({ text }: { text: string }) => formatDateTime(text) },
  // 操作列按当前「编辑 / 删除」两个链接收紧；后续新增按钮时再加宽即可。
  { title: '操作', key: 'actions', width: 88, fixed: 'right' as const },
])
let columns = ref([...allColumns.value])
const tableColumns = computed(() => columns.value.map(column => ({ ...column, sortOrder: column.key === sort.value.sortBy ? sort.value.sortOrder === 'ASC' ? 'ascend' as const : 'descend' as const : null })))
// v2：列结构变过（说明列改弹性、操作列收窄），旧 key 里保存的宽度会让整表被按比例撑开。
const { resizeStart, colWidths, setColumnWidth } = useResizableColumns('starter-example-widths-v2', columns, { title: 220, status: 110, category: 130, updatedAt: 180 })
const exportColumns = computed(() => columns.value.map(column => column.key).filter(key => !['index', 'action', 'actions'].includes(key)).join(','))
const exportUrl = computed(() => exportColumns.value ? getExampleExportUrl({ ...activeQuery.value, cols: exportColumns.value }) : '')
// 新增弹窗状态（本页只有"新增并继续录入"；编辑走详情抽屉原地编辑，不经过这里）
interface ExampleForm { title: string; status: ExampleItem['status']; description: string; category: string }
const exampleFormDefaults = (): ExampleForm => ({ title: '', status: 'pending', description: '', category: '' })
const createModal = useFormModal<ExampleForm>({
  fields: () => ({ title: '标题', status: '状态', description: '说明', category: '类别' }),
  defaults: exampleFormDefaults,
  validate: form => {
    const errors: Record<string, string> = {}
    if (!form.title.trim()) errors.title = '请填写标题'
    else if (Array.from(form.title).length > 100) errors.title = '标题不能超过 100 字'
    if (!statusOptions.some(option => option.value === form.status)) errors.status = '请选择有效状态'
    if (form.category && !categoryOptions.value.some(option => option.value === form.category)) errors.category = '请选择有效的类别'
    if (Array.from(form.description).length > 500) errors.description = '说明不能超过 500 字'
    return errors
  },
  save: async form => {
    await createExample({ ...form }, { errorFeedback: 'form' })
    void fetchRows()
    // 保存并继续：不关弹窗，重置表单连续录入
    message.success('已保存，可继续新增')
    return 'continue'
  },
})
const { visible: modalVisible, loading: modalLoading, form, feedback: createFeedback, modalProps, bindRoot: createFeedbackRoot, open: openCreate, close: closeCreate, submit: save } = createModal
const { errors: createErrors, summary: createFeedbackItems, requestId: createRequestId } = createFeedback
function changeTable(_page: unknown, _filters: Record<string, unknown>, sorter: any) {
  void changeSort({ sortBy: sorter.order ? sorter.field : undefined, sortOrder: sorter.order === 'ascend' ? 'ASC' : sorter.order === 'descend' ? 'DESC' : undefined })
}
async function remove(id: number) { await deleteExample(id); message.success('删除成功'); await fetchRows() }
function openDetail(id: number, edit = false) {
  detailId.value = id
  detailEditRequested.value = edit
  detailOpen.value = true
}
function exportSelected() {
  if (!selectedIds.value.length) return
  if (selectedIds.value.length > 500) { message.warning('一次最多导出 500 条，请减少勾选或使用筛选导出'); return }
  if (!exportColumns.value) { message.warning('请先显示至少一个数据列'); return }
  window.open(getExampleExportUrl({ ...activeQuery.value, ids: selectedIds.value.join(','), cols: exportColumns.value }), '_blank')
}
function isUnknownBatchOutcome(error: unknown): boolean {
  const status = (error as { response?: { status?: number } }).response?.status
  return !status || status >= 500
}

async function removeSelected() {
  if (batchSaving.value || !selectedIds.value.length) return
  if (selectedIds.value.length > 500) { message.warning('一次最多删除 500 条'); return }
  batchSaving.value = true
  try {
    batchResult.value = await batchDeleteExamples([...selectedIds.value])
    batchUnknown.value = false
    batchResultOpen.value = true
    await fetchRows()
  } catch (error) {
    // F37:未收到逐条结果(网络中断/服务端 5xx)时结果未知,不当作失败清单;4xx 整批被拒未执行,拦截器已提示
    if (isUnknownBatchOutcome(error)) {
      batchUnknown.value = true
      batchResultOpen.value = true
      await fetchRows()
    }
  } finally { batchSaving.value = false }
}

/** 仅重试明确失败的原始 ID;成功项不再次提交,失败清单替换为本次明确失败的 */
async function retryFailed() {
  if (batchSaving.value || batchUnknown.value || !batchResult.value.failures.length) return
  batchSaving.value = true
  try {
    const failedIds = batchResult.value.failures.map((failure) => failure.id)
    const result = await batchDeleteExamples(failedIds)
    batchResult.value = { successCount: batchResult.value.successCount + result.successCount, total: batchResult.value.total, failures: result.failures }
    await fetchRows()
  } catch (error) {
    if (isUnknownBatchOutcome(error)) batchUnknown.value = true
  } finally { batchSaving.value = false }
}

async function copyFailures() {
  const lines = batchResult.value.failures.map((failure) => `#${failure.id} ${failure.reason}`)
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    message.success('失败原因已复制')
  } catch {
    message.warning('浏览器未授权剪贴板，请使用“下载失败明细”')
  }
}

function downloadFailures() {
  downloadCsv('batch-delete-failures.csv', ['记录ID', '失败原因'], batchResult.value.failures.map((failure) => [failure.id, failure.reason]))
}
/** F30 导入向导：预检不落库;确认导入由服务端重新校验,部分成功语义(错误行跳过并在结果中逐行说明) */
function onImported() { void fetchRows() }
const deepLink = useDetailDeepLink(id => openDetail(id))
onMounted(() => { deepLink.attach() })
</script>

<style scoped>
.page-body { height: 100%; display: flex; flex-direction: column; background: var(--color-surface); }
.row-title {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-link);
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
/* 默认不加下划线，整列 8 行不会变成一排链接；悬停和键盘聚焦时才出现。 */
.row-title:hover { color: var(--color-link-hover); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.row-title:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; text-decoration: underline; text-underline-offset: 3px; }
.row-title.cell-dash { font-weight: 400; }
/* 状态标签：色点 + 文字，进行中与待处理不再同为灰色。 */
.status-tag { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
.status-tag::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.status-tag.is-pending { color: var(--color-text-secondary); background: var(--color-layer-hover); border-color: transparent; }
.status-tag.is-doing { color: #0056b3; background: var(--color-blue-10); border-color: transparent; }
.status-tag.is-done { color: var(--color-success-text); background: var(--color-green-10); border-color: transparent; }
/* 批量操作条：左侧墨条标记「当前上下文已切换」，与表格选中行呼应。 */
.batch-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-layer-01);
  border-left: 2px solid var(--color-primary);
  border-bottom: var(--rule);
}
.batch-count { font-size: var(--text-aux); color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.batch-count strong { color: var(--color-text-primary); font-weight: 700; }
.batch-failures { margin: 12px 0 0; padding-left: 20px; max-height: 300px; overflow-y: auto; overflow-wrap: anywhere; }
.batch-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.batch-done-note { margin: 12px 0 0; color: var(--color-text-secondary); font-size: var(--text-aux); }
</style>
