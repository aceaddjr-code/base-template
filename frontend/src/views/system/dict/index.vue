<template>
  <Page class="page-list" title="数据字典" description="类型与字典项两级管理；所有下拉框选项都读取这里，修改后即时生效，业务表存量值不会自动同步。">
    <div ref="bodyRef" class="page-body">
      <PageToolbar
        :show-search="false"
        :show-create="true"
        create-label="新增类型"
        @create="showTypeModal()"
      >
        <!-- 筛选行放进工具栏左区：查询条件与「新增类型」同处一行。 -->
        <template #left>
          <ListFilters :tags="filterTags" :dirty="dirty" :failed="failed" @apply="apply()" @reset="reset" @remove="removeFilter" @retry="fetchTypes">
            <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索类型编码/名称" allow-clear style="width:220px" @press-enter="onSearchEnter" /></label>
          </ListFilters>
        </template>
      </PageToolbar>
      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="typeList"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="middle"
        :scroll="{ x: 760, y: tableScrollY }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'code'">
            <a-tag>{{ record.code }}</a-tag>
          </template>
          <template v-if="column.key === 'status'">
            <a-switch :checked="record.status === 1" @change="(v: any) => handleTypeToggle(record, v)" />
          </template>
          <template v-if="column.key === 'itemCount'">
            <a-button type="link" size="small" @click="openItems(record)">
              选项管理（{{ record.itemCount ?? 0 }}）
            </a-button>
          </template>
          <template v-if="column.key === 'remark'">
            {{ record.remark || '-' }}
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="showTypeModal(record)">编辑</a-button>
              <a-popconfirm
                title="确定删除该类型？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleTypeDelete(record)"
              >
                <a-button type="link" size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
        <template #emptyText><a-empty :description="failed ? '查询失败，请重试' : hasKeyword ? '没有匹配的类型' : '暂无字典类型'" /></template>
      </a-table>
    </div>
    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="changePage" />
    </template>
  </Page>

  <!-- 新增/编辑类型弹窗 -->
  <a-modal
    :open="typeModalVisible"
    :title="editTypeId ? '编辑类型' : '新增类型'"
    v-bind="typeModalProps"
    @cancel="closeTypeModal"
    ok-text="保存" cancel-text="取消" @ok="handleTypeSubmit"
    width="520px"
  >
    <div :ref="typeFeedbackRoot">
      <FormFeedback :items="typeFeedbackItems" :request-id="typeRequestId" @focus="typeFeedback.focus" />
      <a-form :model="typeForm" layout="vertical" class="mt-4">
        <a-form-item label="类型编码" required data-form-field="code" :validate-status="typeErrors.code ? 'error' : undefined">
          <a-input
            v-model:value="typeForm.code"
            :disabled="!!editTypeId || typeModalLoading"
            aria-label="类型编码"
            v-bind="typeFeedback.attrs('code')"
            placeholder="英文小写下划线，如 item_category"
            :maxlength="50"
          />
          <p v-if="typeErrors.code" :id="typeFeedback.errorId('code')" class="field-error">{{ typeErrors.code }}</p>
        </a-form-item>
        <a-form-item label="类型名称" required data-form-field="name" :validate-status="typeErrors.name ? 'error' : undefined">
          <a-input v-model:value="typeForm.name" :disabled="typeModalLoading" aria-label="类型名称" v-bind="typeFeedback.attrs('name')" placeholder="如：事项类别" :maxlength="50" />
          <p v-if="typeErrors.name" :id="typeFeedback.errorId('name')" class="field-error">{{ typeErrors.name }}</p>
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="typeForm.remark" :disabled="typeModalLoading" :rows="2" :maxlength="500" />
        </a-form-item>
      </a-form>
    </div>
  </a-modal>

  <!-- 选项管理抽屉 -->
  <a-drawer
    v-model:open="itemsDrawerOpen"
    :title="`选项管理：${currentType?.name ?? ''}（${currentType?.code ?? ''}）`"
    :width="720"
  >
    <div class="flex justify-between items-center mb-4">
      <a-alert type="info" show-icon class="flex-1 mr-3" message="选项的「存储值」是写进业务表的值，改名不影响存量数据" />
      <a-button type="primary" size="small" @click="showItemModal()">新增选项</a-button>
    </div>
    <a-table
      :columns="itemColumns"
      :data-source="itemList"
      :loading="itemsLoading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #headerCell="{ column }">
        <span>{{ column.title }}</span>
        <span class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStartItems(String(column.key), e)" />
      </template>
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'label'">
          <a-tag :color="record.color || undefined">{{ record.label }}</a-tag>
        </template>
        <template v-if="column.key === 'value'">
          <code class="text-sm">{{ record.value }}</code>
        </template>
        <template v-if="column.key === 'sort'">
          {{ record.sort }}
        </template>
        <template v-if="column.key === 'status'">
          <a-switch :checked="record.status === 1" @change="(v: any) => handleItemToggle(record, v)" />
        </template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a-button type="link" size="small" @click="showItemModal(record)">编辑</a-button>
            <a-popconfirm
              title="确定删除该选项？业务表存量值不受影响"
              ok-text="确定"
              cancel-text="取消"
              @confirm="handleItemDelete(record.id)"
            >
              <a-button type="link" size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-drawer>

  <!-- 新增/编辑选项弹窗 -->
  <a-modal
    :open="itemModalVisible"
    :title="editItemId ? '编辑选项' : '新增选项'"
    v-bind="itemModalProps"
    @cancel="closeItemModal"
    ok-text="保存" cancel-text="取消" @ok="handleItemSubmit"
    width="520px"
  >
    <div :ref="itemFeedbackRoot">
      <FormFeedback :items="itemFeedbackItems" :request-id="itemRequestId" @focus="itemFeedback.focus" />
      <a-form :model="itemForm" layout="vertical" class="mt-4">
        <a-form-item label="显示值" required data-form-field="label" :validate-status="itemErrors.label ? 'error' : undefined">
          <a-input v-model:value="itemForm.label" :disabled="itemModalLoading" aria-label="显示值" v-bind="itemFeedback.attrs('label')" placeholder="下拉框看到的文字" :maxlength="50" />
          <p v-if="itemErrors.label" :id="itemFeedback.errorId('label')" class="field-error">{{ itemErrors.label }}</p>
        </a-form-item>
        <a-form-item label="存储值" required data-form-field="value" :validate-status="itemErrors.value ? 'error' : undefined">
          <a-input
            v-model:value="itemForm.value"
            :disabled="itemModalLoading"
            aria-label="存储值"
            v-bind="itemFeedback.attrs('value')"
            placeholder="写进业务表的值（如 high），改名会影响后续新增数据"
            :maxlength="50"
          />
          <p v-if="itemErrors.value" :id="itemFeedback.errorId('value')" class="field-error">{{ itemErrors.value }}</p>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="标签颜色">
              <a-select v-model:value="itemForm.color" allow-clear placeholder="选择颜色">
                <a-select-option v-for="c in COLOR_OPTIONS" :key="c.value" :value="c.value">
                  <a-tag :color="c.value">{{ c.label }}</a-tag>
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="排序号">
              <a-input-number v-model:value="itemForm.sort" :min="0" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="备注">
          <a-input v-model:value="itemForm.remark" :disabled="itemModalLoading" :maxlength="500" />
        </a-form-item>
      </a-form>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { withEmptyDash } from '@/utils/format'
import { ref, computed } from 'vue'
import FormFeedback from '@/components/FormFeedback.vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFilters from '@/components/ListFilters.vue'
import ListFooter from '@/components/ListFooter.vue'
import { useFormModal } from '@/composables/useFormModal'
import { useListQuery } from '@/composables/useListQuery'
import { useAppStore } from '@/stores/app'
import { message } from 'ant-design-vue'
import {
  getDictTypes, createDictType, updateDictType, deleteDictType,
  getDictItems, createDictItem, updateDictItem, deleteDictItem,
  type DictTypeItem, type DictItem,
} from '@/api/dict'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { invalidateDict } from '@/utils/dict-cache'

// 字典项颜色标签选项（对应 a-tag 预设：processing 为蓝色）
const COLOR_OPTIONS = [
  { value: 'processing', label: '蓝' },
  { value: 'success', label: '绿' },
  { value: 'warning', label: '橙' },
  { value: 'error', label: '红' },
  { value: 'default', label: '灰' },
]

// ============ 列表页外壳：Page + PageToolbar + ListFooter + 表头固定 ============
const { setTableRef, stickySource } = useListPage()
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

// ============ 类型列表（草稿→查询：与全部列表页同一模型） ============
const app = useAppStore()
const { draft, applied, dirty, loading, failed, rows: typeList, total, page, pageSize, refresh: fetchTypes, apply, reset, changePage, onSearchEnter, totalText } = useListQuery<{ keyword: string }, DictTypeItem>({
  key: 'system-dict', account: () => app.userInfo?.id, pageSize: 20,
  defaults: () => ({ keyword: '' }),
  normalize: query => ({ keyword: query.keyword.trim() }),
  load: query => getDictTypes({ page: query.page, pageSize: query.pageSize, keyword: query.keyword || undefined }),
  scrollElement: stickySource,
})
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
const hasKeyword = computed(() => !!applied.value.keyword)
const filterTags = computed(() => applied.value.keyword ? [{ key: 'keyword', label: `关键词：${applied.value.keyword}` }] : [])
function removeFilter(key: string) { void apply({ ...applied.value, [key]: '' }) }

// v2：操作列由图标按钮改为文字链接（60→88）并固定右侧，旧 key 保存的 60px 会让两个链接换行。
const columns = withEmptyDash([
  { title: '类型编码', key: 'code', dataIndex: 'code', width: 180 },
  { title: '类型名称', dataIndex: 'name', key: 'name', width: 160 },
  { title: '选项', key: 'itemCount', dataIndex: 'itemCount', width: 140 },
  { title: '启用', key: 'status', dataIndex: 'status', width: 80 },
  { title: '备注', key: 'remark', dataIndex: 'remark' },
  { title: '操作', key: 'action', width: 88, fixed: 'right' as const },
])
const { resizeStart } = useResizableColumns('starter-cols-dict-main-width-v2', ref(columns), { code: 180, name: 160, itemCount: 140, status: 80, action: 88 })

async function handleTypeToggle(record: any, v: any) {
  try {
    await updateDictType(record.id, { status: v ? 1 : 0 })
    invalidateDict(record.code)
    record.status = v ? 1 : 0
    message.success('已更新')
  } catch { /* */ }
}

// ============ 类型新增/编辑 ============
const typeModal = useFormModal<{ code: string; name: string; remark: string }, number>({
  fields: () => ({ code: '类型编码', name: '类型名称' }),
  defaults: () => ({ code: '', name: '', remark: '' }),
  validate: form => ({
    ...(form.code.trim() ? {} : { code: '请输入类型编码' }),
    ...(form.name.trim() ? {} : { name: '请输入类型名称' }),
  }),
  save: async (form, editId) => {
    const options = { errorFeedback: 'form' } as const
    if (editId != null) {
      await updateDictType(editId, { name: form.name.trim(), remark: form.remark || undefined }, options)
      invalidateDict(form.code.trim())
      message.success('保存成功')
    } else {
      await createDictType({ code: form.code.trim(), name: form.name.trim(), remark: form.remark || undefined }, options)
      invalidateDict(form.code.trim().toLowerCase())
      message.success('新增成功')
    }
    void fetchTypes()
  },
})
const { visible: typeModalVisible, loading: typeModalLoading, editId: editTypeId, form: typeForm, feedback: typeFeedback, modalProps: typeModalProps, bindRoot: typeFeedbackRoot, close: closeTypeModal, submit: handleTypeSubmit } = typeModal
const { summary: typeFeedbackItems, requestId: typeRequestId, errors: typeErrors } = typeFeedback

function showTypeModal(record?: any) {
  typeModal.open(record?.id ?? null, { code: record?.code || '', name: record?.name || '', remark: record?.remark || '' })
}

async function handleTypeDelete(record: any) {
  try {
    await deleteDictType(record.id)
    invalidateDict(record.code)
    message.success('删除成功')
    void fetchTypes()
  } catch { /* */ }
}

// ============ 选项管理 ============
const itemsDrawerOpen = ref(false)
const itemsLoading = ref(false)
const currentType = ref<DictTypeItem | null>(null)
const itemList = ref<DictItem[]>([])
// v2：操作列改为文字链接并收紧（140→88）。
const itemColumns = withEmptyDash([
  { title: '显示值', key: 'label', dataIndex: 'label', width: 140 },
  { title: '存储值', key: 'value', dataIndex: 'value', width: 140 },
  { title: '排序', key: 'sort', dataIndex: 'sort', width: 70 },
  { title: '启用', key: 'status', dataIndex: 'status', width: 80 },
  { title: '操作', key: 'action', width: 88 },
])
const { resizeStart: resizeStartItems } = useResizableColumns('starter-cols-dict-items-main-width-v2', ref(itemColumns), { label: 140, value: 140, sort: 70, status: 80, action: 88 })

async function openItems(record: any) {
  currentType.value = record
  itemList.value = []
  itemsDrawerOpen.value = true
  await fetchItems()
}

async function fetchItems() {
  if (!currentType.value) return
  itemsLoading.value = true
  try {
    itemList.value = await getDictItems(currentType.value.id)
  } catch { /* */ } finally {
    itemsLoading.value = false
  }
}

// ============ 选项新增/编辑 ============
const itemModal = useFormModal<{ label: string; value: string; color: string | undefined; sort: number; remark: string }, number>({
  fields: () => ({ label: '显示值', value: '存储值' }),
  defaults: () => ({ label: '', value: '', color: undefined, sort: 0, remark: '' }),
  validate: form => ({
    ...(form.label.trim() ? {} : { label: '请输入显示值' }),
    ...(form.value.trim() ? {} : { value: '请输入存储值' }),
  }),
  save: async (form, editId) => {
    if (!currentType.value) return
    const data = {
      label: form.label.trim(),
      value: form.value.trim(),
      color: form.color || null,
      sort: form.sort,
      remark: form.remark || undefined,
    }
    const options = { errorFeedback: 'form' } as const
    if (editId != null) {
      await updateDictItem(editId, data, options)
      message.success('保存成功')
    } else {
      await createDictItem(currentType.value.id, data, options)
      message.success('新增成功')
    }
    invalidateDict(currentType.value.code)
    fetchItems()
    void fetchTypes()
  },
})
const { visible: itemModalVisible, loading: itemModalLoading, editId: editItemId, form: itemForm, feedback: itemFeedback, modalProps: itemModalProps, bindRoot: itemFeedbackRoot, close: closeItemModal, submit: handleItemSubmit } = itemModal
const { summary: itemFeedbackItems, requestId: itemRequestId, errors: itemErrors } = itemFeedback

function showItemModal(record?: any) {
  itemModal.open(record?.id ?? null, { label: record?.label || '', value: record?.value || '', color: record?.color || undefined, sort: record?.sort ?? 0, remark: record?.remark || '' })
}

async function handleItemToggle(record: any, v: any) {
  try {
    await updateDictItem(record.id, { status: v ? 1 : 0 })
    if (currentType.value) invalidateDict(currentType.value.code)
    record.status = v ? 1 : 0
  } catch { /* */ }
}

async function handleItemDelete(id: number) {
  try {
    await deleteDictItem(id)
    if (currentType.value) invalidateDict(currentType.value.code)
    message.success('删除成功')
    fetchItems()
    void fetchTypes()
  } catch { /* */ }
}

</script>

<style scoped>
/* 列表滚动链（.page-body）由 style.css 统一提供，页面不再重复定义。 */
</style>
