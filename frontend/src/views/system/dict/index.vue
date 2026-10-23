<template>
  <div class="p-6 h-full flex flex-col">
    <div class="shrink-0">
    </div>

    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="flex justify-between items-center mb-4 gap-3">
        <div class="flex items-center gap-3 flex-1">
          <a-alert
            type="info"
            show-icon
            class="flex-1"
            message="所有下拉框选项都读取这里，修改后即时生效；业务表存量值不会自动同步"
          />
          <a-input
            v-model:value="keyword"
            placeholder="搜索类型编码/名称"
            allow-clear
            class="max-w-xs"
            @press-enter="fetchTypes(1)"
          />
          <a-button type="primary" @click="fetchTypes(1)">查询</a-button>
        </div>
        <a-button type="primary" @click="showTypeModal()">
          新增类型
        </a-button>
      </div>

      <a-table
        :columns="columns"
        :data-source="typeList"
        :loading="loading"
        :pagination="{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          onChange: (p: number) => fetchTypes(p),
        }"
        row-key="id"
        size="middle"
        :scroll="{ x: 'max-content' }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
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
              <a-tooltip title="编辑"><a-button aria-label="编辑类型" @click="showTypeModal(record)" class="w-6! h-6! px-0!" type="text" size="small"><EditOutlined /></a-button></a-tooltip>
              <a-popconfirm
                title="确定删除该类型？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleTypeDelete(record)"
              >
                <a-tooltip title="删除"><a-button aria-label="删除类型" danger class="w-6! h-6! px-0!" type="text" size="small"><DeleteOutlined /></a-button></a-tooltip>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
          </div>
    </a-card>

    <!-- 新增/编辑类型弹窗 -->
    <a-modal
      :open="typeModalVisible"
      :title="editTypeId ? '编辑类型' : '新增类型'"
      :confirm-loading="typeModalLoading"
      :mask-closable="!typeModalLoading" :keyboard="!typeModalLoading" :closable="!typeModalLoading"
      :cancel-button-props="{ disabled: typeModalLoading }" @cancel="closeTypeModal"
      ok-text="保存" cancel-text="取消" @ok="handleTypeSubmit"
      width="520px"
    >
      <div ref="typeFeedbackRoot">
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
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStartItems(String(column.key), e)" />
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
              <a-tooltip title="编辑"><a-button aria-label="编辑选项" @click="showItemModal(record)" class="w-6! h-6! px-0!" type="text" size="small"><EditOutlined /></a-button></a-tooltip>
              <a-popconfirm
                title="确定删除该选项？业务表存量值不受影响"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleItemDelete(record.id)"
              >
                <a-tooltip title="删除"><a-button aria-label="删除选项" danger class="w-6! h-6! px-0!" type="text" size="small"><DeleteOutlined /></a-button></a-tooltip>
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
      :confirm-loading="itemModalLoading"
      :mask-closable="!itemModalLoading" :keyboard="!itemModalLoading" :closable="!itemModalLoading"
      :cancel-button-props="{ disabled: itemModalLoading }" @cancel="closeItemModal"
      ok-text="保存" cancel-text="取消" @ok="handleItemSubmit"
      width="520px"
    >
      <div ref="itemFeedbackRoot">
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
  </div>
</template>

<script setup lang="ts">
import { withEmptyDash } from '@/utils/format'
import { ref, reactive, onMounted } from 'vue'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons-vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormFeedback } from '@/composables/useFormFeedback'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { message } from 'ant-design-vue'
import {
  getDictTypes, createDictType, updateDictType, deleteDictType,
  getDictItems, createDictItem, updateDictItem, deleteDictItem,
  type DictTypeItem, type DictItem,
} from '@/api/dict'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { invalidateDict } from '@/utils/dict-cache'

const COLOR_OPTIONS = [
  { value: 'processing', label: '红' },
  { value: 'success', label: '绿' },
  { value: 'warning', label: '橙' },
  { value: 'error', label: '深红' },
  { value: 'default', label: '灰' },
]

// ============ 类型列表 ============
const loading = ref(false)
const typeList = ref<DictTypeItem[]>([])
const keyword = ref('')
const page = ref(1)
const pageSize = 20
const total = ref(0)
const columns = withEmptyDash([
  { title: '类型编码', key: 'code', dataIndex: 'code', width: 180 },
  { title: '类型名称', dataIndex: 'name', key: 'name', width: 160 },
  { title: '选项', key: 'itemCount', dataIndex: 'itemCount', width: 140 },
  { title: '启用', key: 'status', dataIndex: 'status', width: 80 },
  { title: '备注', key: 'remark', dataIndex: 'remark' },
  { title: '操作', key: 'action', width: 60 },
])
const { resizeStart } = useResizableColumns('starter-cols-dict-main-width', ref(columns))

async function fetchTypes(p = 1) {
  page.value = p
  loading.value = true
  try {
    const data = await getDictTypes({ page: p, pageSize, keyword: keyword.value || undefined })
    typeList.value = data.list
    total.value = data.total
  } catch {
    /* 拦截器已提示 */
  } finally {
    loading.value = false
  }
}

async function handleTypeToggle(record: any, v: any) {
  try {
    await updateDictType(record.id, { status: v ? 1 : 0 })
    invalidateDict(record.code)
    record.status = v ? 1 : 0
    message.success('已更新')
  } catch { /* */ }
}

// ============ 类型新增/编辑 ============
const typeModalVisible = ref(false)
const typeModalLoading = ref(false)
const editTypeId = ref(0)
const typeForm = reactive({ code: '', name: '', remark: '' })

const typeFeedbackRoot = ref<HTMLElement | null>(null)
const typeFeedback = useFormFeedback({ root: typeFeedbackRoot, fields: () => ({ code: '类型编码', name: '类型名称' }), values: () => ({ code: typeForm.code, name: typeForm.name }) })
const { summary: typeFeedbackItems, requestId: typeRequestId, errors: typeErrors } = typeFeedback
let typeBaseline = ''
const typeUnsaved = useUnsavedChanges({
  active: () => typeModalVisible.value,
  dirty: () => JSON.stringify({ code: typeForm.code, name: typeForm.name, remark: typeForm.remark }) !== typeBaseline,
  saving: () => typeModalLoading.value,
})
function closeTypeModal() { void typeUnsaved.attempt(() => { typeModalVisible.value = false; typeFeedback.clear() }) }

function showTypeModal(record?: any) {
  editTypeId.value = record?.id || 0
  typeForm.code = record?.code || ''
  typeForm.name = record?.name || ''
  typeForm.remark = record?.remark || ''
  typeFeedback.clear()
  typeBaseline = JSON.stringify({ code: typeForm.code, name: typeForm.name, remark: typeForm.remark })
  typeModalVisible.value = true
}

async function handleTypeSubmit() {
  if (typeModalLoading.value) return
  const localErrors: Record<string, string> = {}
  if (!typeForm.code.trim()) localErrors.code = '请输入类型编码'
  if (!typeForm.name.trim()) localErrors.name = '请输入类型名称'
  if (!(await typeFeedback.validate(localErrors))) return
  typeModalLoading.value = true
  try {
    const options = { errorFeedback: 'form' } as const
    if (editTypeId.value) {
      await updateDictType(editTypeId.value, { name: typeForm.name.trim(), remark: typeForm.remark || undefined }, options)
      invalidateDict(typeForm.code.trim())
      message.success('保存成功')
    } else {
      await createDictType({ code: typeForm.code.trim(), name: typeForm.name.trim(), remark: typeForm.remark || undefined }, options)
      invalidateDict(typeForm.code.trim().toLowerCase())
      message.success('新增成功')
    }
    typeModalVisible.value = false
    fetchTypes(page.value)
  } catch (error) {
    await typeFeedback.capture(error)
  } finally {
    typeModalLoading.value = false
  }
}

async function handleTypeDelete(record: any) {
  try {
    await deleteDictType(record.id)
    invalidateDict(record.code)
    message.success('删除成功')
    fetchTypes(page.value)
  } catch { /* */ }
}

// ============ 选项管理 ============
const itemsDrawerOpen = ref(false)
const itemsLoading = ref(false)
const currentType = ref<DictTypeItem | null>(null)
const itemList = ref<DictItem[]>([])
const itemColumns = withEmptyDash([
  { title: '显示值', key: 'label', dataIndex: 'label', width: 140 },
  { title: '存储值', key: 'value', dataIndex: 'value', width: 140 },
  { title: '排序', key: 'sort', dataIndex: 'sort', width: 70 },
  { title: '启用', key: 'status', dataIndex: 'status', width: 80 },
  { title: '操作', key: 'action', width: 140 },
])
const { resizeStart: resizeStartItems } = useResizableColumns('starter-cols-dict-items-main-width', ref(itemColumns))

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
const itemModalVisible = ref(false)
const itemModalLoading = ref(false)
const editItemId = ref(0)
const itemForm = reactive({ label: '', value: '', color: undefined as string | undefined, sort: 0, remark: '' })

const itemFeedbackRoot = ref<HTMLElement | null>(null)
const itemFeedback = useFormFeedback({ root: itemFeedbackRoot, fields: () => ({ label: '显示值', value: '存储值' }), values: () => ({ label: itemForm.label, value: itemForm.value }) })
const { summary: itemFeedbackItems, requestId: itemRequestId, errors: itemErrors } = itemFeedback
let itemBaseline = ''
const itemUnsaved = useUnsavedChanges({
  active: () => itemModalVisible.value,
  dirty: () => JSON.stringify({ label: itemForm.label, value: itemForm.value, color: itemForm.color, sort: itemForm.sort, remark: itemForm.remark }) !== itemBaseline,
  saving: () => itemModalLoading.value,
})
function closeItemModal() { void itemUnsaved.attempt(() => { itemModalVisible.value = false; itemFeedback.clear() }) }

function showItemModal(record?: any) {
  editItemId.value = record?.id || 0
  itemForm.label = record?.label || ''
  itemForm.value = record?.value || ''
  itemForm.color = record?.color || undefined
  itemForm.sort = record?.sort ?? 0
  itemForm.remark = record?.remark || ''
  itemFeedback.clear()
  itemBaseline = JSON.stringify({ label: itemForm.label, value: itemForm.value, color: itemForm.color, sort: itemForm.sort, remark: itemForm.remark })
  itemModalVisible.value = true
}

async function handleItemSubmit() {
  if (itemModalLoading.value) return
  if (!currentType.value) return
  const localErrors: Record<string, string> = {}
  if (!itemForm.label.trim()) localErrors.label = '请输入显示值'
  if (!itemForm.value.trim()) localErrors.value = '请输入存储值'
  if (!(await itemFeedback.validate(localErrors))) return
  itemModalLoading.value = true
  try {
    const data = {
      label: itemForm.label.trim(),
      value: itemForm.value.trim(),
      color: itemForm.color || null,
      sort: itemForm.sort,
      remark: itemForm.remark || undefined,
    }
    const options = { errorFeedback: 'form' } as const
    if (editItemId.value) {
      await updateDictItem(editItemId.value, data, options)
      message.success('保存成功')
    } else {
      await createDictItem(currentType.value.id, data, options)
      message.success('新增成功')
    }
    itemModalVisible.value = false
    invalidateDict(currentType.value.code)
    fetchItems()
    fetchTypes(page.value)
  } catch (error) {
    await itemFeedback.capture(error)
  } finally {
    itemModalLoading.value = false
  }
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
    fetchTypes(page.value)
  } catch { /* */ }
}

onMounted(() => fetchTypes(1))
</script>
