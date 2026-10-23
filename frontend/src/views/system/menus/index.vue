<template>
  <div class="p-0 h-full flex flex-col page-list">

    <div class="shrink-0 pr-4 ml-2.5 pt-2.5">
      <div class="page-head-rule flex items-end justify-between mb-1.5">
        <div>
          <div class="text-xl font-bold text-[#201d1d] leading-none tracking-tight">菜单管理</div>
          <div class="text-sm text-[#646262] mt-2">菜单树 · 按钮权限</div>
        </div>
      <div class="text-sm text-[#646262]">今日 {{ todayStr }}</div>
      </div>
    </div>

    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 min-h-0 overflow-y-auto">
      <!-- 标题栏 -->
      <div class="flex justify-between items-center mb-4">
        <a-button type="primary" @click="showCreateModal(null)">
          新增
        </a-button>
        <ColumnSettings v-model:columns="columns" :all-columns="allColumns" storage-key="starter-cols-menus-main" />
      </div>

      <!-- 表格：将树形数据展平 -->
      <a-table
        :ref="setTableRef"
        :columns="columns"
        :data-source="flatData"
        :loading="loading"
        :pagination="false"
        :default-expand-all-rows="false"
        row-key="id"
        size="middle"
        :children-column-name="'__children'"
        :scroll="{ x: 'max-content' }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span class="resize-handle" @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'icon'">
            {{ record.icon || '-' }}
          </template>
          <template v-if="column.key === 'type'">
            <a-tag :color="record.type === 'menu' ? 'processing' : 'warning'">
              {{ record.type === 'menu' ? '菜单' : '按钮' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'path'">
            {{ record.path || '-' }}
          </template>
          <template v-if="column.key === 'permission'">
            {{ record.permission || '-' }}
          </template>
          <template v-if="column.key === 'status'">
            <a-badge :status="record.status === 1 ? 'success' : 'error'" :text="record.status === 1 ? '启用' : '禁用'" />
          </template>
          <template v-if="column.key === 'sort'">
            {{ record.sort ?? 0 }}
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-tooltip title="添加子项"><a-button aria-label="添加子项" class="w-6! h-6! px-0!" type="text" size="small" @click="showCreateModal(record)"><PlusOutlined /></a-button></a-tooltip>
              <a-tooltip title="编辑"><a-button aria-label="编辑菜单" @click="showEditModal(record)" class="w-6! h-6! px-0!" type="text" size="small"><EditOutlined /></a-button></a-tooltip>
              <a-popconfirm
                title="确定要删除该菜单吗？如有子菜单会失败。"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleDelete(record.id)"
              >
                <a-tooltip title="删除"><a-button aria-label="删除菜单" danger class="w-6! h-6! px-0!" type="text" size="small"><DeleteOutlined /></a-button></a-tooltip>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
          </div>
    </a-card>

    <div class="shrink-0 bg-white">
      <StickyScrollBar :source="stickySource" />
      <div class="flex items-center justify-end px-4 py-1">
        <span class="text-sm text-[#646262]">共 {{ treeData.length }} 条</span>
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <a-modal
      :open="modalVisible"
      :title="modalTitle"
      :confirm-loading="modalLoading"
      :mask-closable="!modalLoading" :keyboard="!modalLoading" :closable="!modalLoading"
      :cancel-button-props="{ disabled: modalLoading }" @cancel="closeModal"
      ok-text="保存" cancel-text="取消" @ok="handleSubmit"
    >

      <div ref="feedbackRoot">
      <FormFeedback :items="feedbackItems" :request-id="feedbackRequestId" @focus="feedback.focus" />
      <a-form :model="form" layout="vertical">
        <a-row :gutter="8">
          <a-col :span="24">
            <!-- 父级菜单：新增子项时显示 -->
            <a-form-item v-if="parentMenu" label="父级菜单">
              <a-input :value="parentMenu.name" disabled />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="菜单名称" required data-form-field="name" :validate-status="formErrors.name ? 'error' : undefined">
              <a-input v-model:value="form.name" :disabled="modalLoading" aria-label="菜单名称" v-bind="feedback.attrs('name')" placeholder="如：用户管理" :maxlength="50" />
              <p v-if="formErrors.name" :id="feedback.errorId('name')" class="field-error">{{ formErrors.name }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="路由路径" data-form-field="path" :validate-status="formErrors.path ? 'error' : undefined">
              <a-input v-model:value="form.path" :disabled="modalLoading" aria-label="路由路径" v-bind="feedback.attrs('path')" placeholder="如：/system/users" :maxlength="200" />
              <p v-if="formErrors.path" :id="feedback.errorId('path')" class="field-error">{{ formErrors.path }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="图标">
              <a-input v-model:value="form.icon" placeholder="Ant Design 图标名，如 SettingOutlined" :maxlength="50" />
              <div class="text-gray-400 text-sm mt-1">仅菜单类型有效，按钮类型忽略</div>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="类型">
              <a-radio-group v-model:value="form.type">
                <a-radio value="menu">菜单</a-radio>
                <a-radio value="button">按钮</a-radio>
              </a-radio-group>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item v-if="form.type === 'button'" label="权限标识" data-form-field="permission" :validate-status="formErrors.permission ? 'error' : undefined">
              <a-input v-model:value="form.permission" :disabled="modalLoading" aria-label="权限标识" v-bind="feedback.attrs('permission')" placeholder="如：user:delete" :maxlength="100" />
              <p v-if="formErrors.permission" :id="feedback.errorId('permission')" class="field-error">{{ formErrors.permission }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="排序">
              <a-input-number v-model:value="form.sort" :min="0" :max="9999" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { withEmptyDash } from '@/utils/format'
import StickyScrollBar from '@/components/StickyScrollBar.vue'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'
import { ref, reactive, computed, onMounted } from 'vue'
import { EditOutlined, DeleteOutlined , PlusOutlined } from '@ant-design/icons-vue'
import ColumnSettings from '@/components/ColumnSettings.vue'
import { message } from 'ant-design-vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormFeedback } from '@/composables/useFormFeedback'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import { getMenus, createMenu, updateMenu, deleteMenu, type MenuItem } from '@/api/menu'

// ============ 将树形数据扁平化 ============
function flattenTree(tree: MenuItem[], level = 0): (MenuItem & { __level: number })[] {
  const result: (MenuItem & { __level: number })[] = []
  for (const item of tree) {
    result.push({ ...item, __level: level })
    if (item.children?.length) {
      result.push(...flattenTree(item.children, level + 1))
    }
  }
  return result
}

// ============ 状态 ============
const loading = ref(false)
const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
const { setTableRef, stickySource } = useListPage()

const treeData = ref<MenuItem[]>([])
const flatData = computed(() => flattenTree(treeData.value))

// ============ 列宽拖拽 ============
const allColumns = ref(withEmptyDash([
  { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '图标', key: 'icon', width: 100 },
  { title: '类型', key: 'type', width: 80 },
  { title: '路径', key: 'path', width: 180 },
  { title: '权限标识', key: 'permission', width: 150 },
  { title: '排序', key: 'sort', width: 70 },
  { title: '状态', key: 'status', width: 80 },
  { title: '操作', key: 'action', width: 80 },
]))
const columns = ref([...allColumns.value])
const { resizeStart } = useResizableColumns('starter-cols-menus-main-width', columns, {
  name: 180, icon: 100, type: 80, path: 180, permission: 150, sort: 70, status: 80, action: 80,
})

// ============ 数据获取 ============
async function fetchData() {
  loading.value = true
  try {
    treeData.value = await getMenus()
  } finally {
    loading.value = false
  }
}

// ============ 新增/编辑 ============
const modalVisible = ref(false)
const modalLoading = ref(false)
const isEdit = ref(false)
const parentMenu = ref<MenuItem | null>(null)
const form = reactive({
  id: 0,
  parentId: undefined as number | undefined,
  name: '',
  path: '',
  icon: '',
  type: 'menu' as string,
  permission: '',
  sort: 0,
})
const feedbackRoot = ref<HTMLElement | null>(null)
const feedback = useFormFeedback({ root: feedbackRoot, fields: () => ({ name: '菜单名称', path: '路由路径', permission: '权限标识' }), values: () => ({ ...form }) })
const { summary: feedbackItems, requestId: feedbackRequestId, errors: formErrors } = feedback
let baseline = ''
const unsaved = useUnsavedChanges({ active: () => modalVisible.value, dirty: () => JSON.stringify({ ...form }) !== baseline, saving: () => modalLoading.value })
function closeModal() { void unsaved.attempt(() => { modalVisible.value = false; feedback.clear() }) }

const modalTitle = computed(() => {
  if (isEdit.value) return '编辑菜单'
  if (parentMenu.value) return `添加子菜单 - ${parentMenu.value.name}`
  return '新增顶级菜单'
})

function showCreateModal(parent: any | null) {
  isEdit.value = false
  parentMenu.value = parent
  form.id = 0
  form.parentId = parent?.id || undefined
  form.name = ''
  form.path = ''
  form.icon = ''
  form.type = 'menu'
  form.permission = ''
  form.sort = 0
  feedback.clear()
  baseline = JSON.stringify({ ...form })
  modalVisible.value = true
}

function showEditModal(record: any) {
  isEdit.value = true
  parentMenu.value = null
  form.id = record.id
  form.parentId = record.parentId || undefined
  form.name = record.name
  form.path = record.path || ''
  form.icon = record.icon || ''
  form.type = record.type || 'menu'
  form.permission = record.permission || ''
  form.sort = record.sort ?? 0
  feedback.clear()
  baseline = JSON.stringify({ ...form })
  modalVisible.value = true
}

async function handleSubmit() {
  if (modalLoading.value) return
  const localErrors: Record<string, string> = {}
  if (!form.name.trim()) localErrors.name = '菜单名称不能为空'
  if (!(await feedback.validate(localErrors))) return
  modalLoading.value = true
  try {
    const options = { errorFeedback: 'form' } as const
    if (isEdit.value) {
      await updateMenu(form.id, {
        name: form.name.trim(),
        path: form.path || undefined,
        icon: form.icon || undefined,
        type: form.type,
        permission: form.type === 'button' ? (form.permission || null) : null,
        sort: form.sort,
      }, options)
      message.success('保存成功')
    } else {
      await createMenu({
        parentId: form.parentId,
        name: form.name.trim(),
        path: form.path || undefined,
        icon: form.type === 'menu' ? (form.icon || undefined) : undefined,
        type: form.type,
        permission: form.type === 'button' ? (form.permission || undefined) : undefined,
        sort: form.sort,
      }, options)
      message.success('创建成功')
    }
    modalVisible.value = false
    fetchData()
  } catch (error) {
    await feedback.capture(error)
  } finally { modalLoading.value = false }
}

// ============ 删除 ============
async function handleDelete(id: number) {
  try {
    await deleteMenu(id)
    message.success('删除成功')
    fetchData()
  } catch { /* */ }
}

// ============ 初始化 ============
onMounted(() => {
  fetchData()
})
</script>
