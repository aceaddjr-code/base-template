<template>
  <Page class="page-list" title="菜单管理" description="菜单树 · 按钮权限">
    <div ref="bodyRef" class="menus-body">
      <PageToolbar
        :show-search="false"
        :show-create="true"
        :menu-items="['columns']"
        :columns="columns"
        :all-columns="allColumns"
        column-settings-key="starter-cols-menus-main"
        :resizable="menusResizable"
        :locked-keys="['action']"
        @create="showCreateModal(null)"
        @update:columns="columns = $event"
      >
        <template #actions>
          <a-button v-if="failed" size="small" @click="fetchData">重试</a-button>
        </template>
      </PageToolbar>

      <!-- 表格：树形数据按深度展平，名称列用缩进表达层级 -->
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
        :scroll="{ x: 1016, y: tableScrollY }"
      >
        <template #headerCell="{ column }">
          <span>{{ column.title }}</span>
          <span v-if="column.key !== 'action'" class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <span class="menu-name" :style="{ paddingLeft: `${(record.__level ?? 0) * 16}px` }">{{ record.name }}</span>
          </template>
          <template v-else-if="column.key === 'icon' || column.key === 'path' || column.key === 'permission'">
            <span class="menu-value" :title="record[column.key] || undefined">{{ record[column.key] || '-' }}</span>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="record.type === 'menu' ? 'processing' : 'warning'">
              {{ record.type === 'menu' ? '菜单' : '按钮' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-badge :status="record.status === 1 ? 'success' : 'error'" :text="record.status === 1 ? '启用' : '禁用'" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="showCreateModal(record)">新增子项</a-button>
              <a-button type="link" size="small" @click="showEditModal(record)">编辑</a-button>
              <a-popconfirm
                title="确定要删除该菜单吗？如有子菜单会失败。"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleDelete(record.id)"
              >
                <a-button type="link" danger size="small">删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
        <template #emptyText><a-empty :description="failed ? '菜单加载失败，请重试' : '暂无菜单'" /></template>
      </a-table>
    </div>
    <!-- 全量树无分页：页脚只承载横滚条与总数文案 -->
    <template #footer>
      <div class="menus-footer">
        <StickyScrollBar :source="stickySource" />
        <div class="menus-footer-meta">共 {{ treeData.length }} 条</div>
      </div>
    </template>
  </Page>

  <!-- 新增/编辑弹窗 -->
  <a-modal
      :open="modalVisible"
      :title="modalTitle"
      v-bind="modalProps"
      @cancel="closeModal"
      ok-text="保存" cancel-text="取消" @ok="handleSubmit"
    >

      <div :ref="feedbackRoot">
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
              <div class="field-hint">仅菜单类型有效，按钮类型忽略</div>
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
</template>

<script setup lang="ts">
import { withEmptyDash } from '@/utils/format'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import StickyScrollBar from '@/components/StickyScrollBar.vue'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
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
const failed = ref(false)
const { setTableRef, stickySource } = useListPage()
// 表头固定 + body 内部滚动：高度由容器实测，工具栏换行时自动重算
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

const treeData = ref<MenuItem[]>([])
const flatData = computed(() => flattenTree(treeData.value))

// ============ 列宽拖拽 ============
const allColumns = ref(withEmptyDash([
  { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '图标', dataIndex: 'icon', key: 'icon', width: 100 },
  { title: '类型', key: 'type', width: 80 },
  { title: '路径', dataIndex: 'path', key: 'path', width: 180 },
  { title: '权限标识', dataIndex: 'permission', key: 'permission', width: 150 },
  { title: '排序', dataIndex: 'sort', key: 'sort', width: 70 },
  { title: '状态', key: 'status', width: 80 },
  // 操作列改为文字链接（新增子项/编辑/删除），按现有按钮收紧
  { title: '操作', key: 'action', width: 168, fixed: 'right' as const },
]))
const columns = ref([...allColumns.value])
// v2：操作列从图标改为 3 个文字链接并固定右侧，旧 key 里保存的 80px 宽度会把按钮挤换行
const { resizeStart, colWidths, setColumnWidth } = useResizableColumns('starter-cols-menus-main-width-v2', columns, {
  name: 180, icon: 100, type: 80, path: 180, permission: 150, sort: 70, status: 80, action: 168,
})
const menusResizable = computed(() => ({ colWidths, setColumnWidth }))

// ============ 数据获取 ============
async function fetchData() {
  loading.value = true
  failed.value = false
  try {
    treeData.value = await getMenus()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

// ============ 新增/编辑 ============
const parentMenu = ref<MenuItem | null>(null)
interface MenuForm { parentId: number | undefined; name: string; path: string; icon: string; type: string; permission: string; sort: number }
const menuModal = useFormModal<MenuForm, number>({
  fields: () => ({ name: '菜单名称', path: '路由路径', permission: '权限标识' }),
  defaults: () => ({ parentId: undefined, name: '', path: '', icon: '', type: 'menu', permission: '', sort: 0 }),
  validate: form => (form.name.trim() ? {} : { name: '菜单名称不能为空' }),
  save: async (form, editId) => {
    const options = { errorFeedback: 'form' } as const
    if (editId != null) {
      await updateMenu(editId, {
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
    fetchData()
  },
})
const { visible: modalVisible, loading: modalLoading, editId, form, feedback, modalProps, close: closeModal, submit: handleSubmit } = menuModal
const isEdit = computed(() => editId.value != null)
const { summary: feedbackItems, requestId: feedbackRequestId, errors: formErrors } = feedback
const feedbackRoot = menuModal.bindRoot

const modalTitle = computed(() => {
  if (isEdit.value) return '编辑菜单'
  if (parentMenu.value) return `添加子菜单 - ${parentMenu.value.name}`
  return '新增顶级菜单'
})

function showCreateModal(parent: any | null) {
  parentMenu.value = parent
  menuModal.open(null, { parentId: parent?.id || undefined })
}

function showEditModal(record: any) {
  parentMenu.value = null
  menuModal.open(record.id, {
    parentId: record.parentId || undefined,
    name: record.name,
    path: record.path || '',
    icon: record.icon || '',
    type: record.type || 'menu',
    permission: record.permission || '',
    sort: record.sort ?? 0,
  })
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

<style scoped>
.menus-body { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--color-surface); }
.menus-body > .ant-table-wrapper { min-height: 0; overflow: hidden; }
/* 名称列缩进表达树层级，长名称允许截断省略 */
.menu-name { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.menu-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 全量树页脚：横滚条 + 总数，无分页器 */
.menus-footer { background: var(--color-surface); border-top: var(--rule); flex-shrink: 0; }
.menus-footer-meta { display: flex; justify-content: flex-end; padding: var(--space-2) 0; color: var(--color-text-tertiary); font-size: var(--text-aux); font-variant-numeric: tabular-nums; }
/* 弹窗字段提示（替代 text-gray-400 硬编码灰） */
.field-hint { margin-top: var(--space-1); font-size: var(--text-aux); color: var(--color-text-tertiary); }
</style>
