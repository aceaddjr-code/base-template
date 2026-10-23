<template>
  <div class="p-0 h-full flex flex-col page-list">

    <div class="shrink-0 pr-4 ml-2.5 pt-2.5">
      <div class="page-head-rule flex items-end justify-between mb-1.5">
        <div>
          <div class="text-xl font-bold text-[#201d1d] leading-none tracking-tight">角色管理</div>
          <div class="text-sm text-[#646262] mt-2">菜单权限 · 数据范围</div>
        </div>
        <div class="text-sm text-[#646262]">今日 {{ todayStr }}</div>
      </div>
    </div>

    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col roles-matrix-card">
      <div class="roles-layout flex-1 min-h-0 flex">
        <!-- ===== 左：角色列表 ===== -->
        <div class="role-sidebar w-[280px] shrink-0 flex flex-col border-r border-[rgba(15,0,0,0.12)]">
          <div class="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
            <span class="text-sm font-semibold text-[#201d1d]">角色列表</span>
            <span class="text-sm text-[#646262]">共 {{ filteredRoles.length }} 个</span>
          </div>
          <div class="shrink-0 px-3">
            <a-input v-model:value="roleKeyword" placeholder="搜索角色名称 / 编码" allow-clear>
              <template #prefix><SearchOutlined /></template>
            </a-input>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto px-1.5 py-2">
            <div
              v-for="r in pagedRoles"
              :key="r.id"
              class="role-item group"
              :class="{ 'role-item-active': selectedRole?.id === r.id }"
              @click="onRoleItemClick(r, $event)"
            >
              <div class="flex items-center justify-between gap-1">
                <span class="role-name">{{ r.name }}</span>
                <span class="flex items-center gap-1">
                  <a-tag v-if="r.code === 'admin'" color="processing" class="m-0! text-[10px]! leading-none! px-1! py-0.5!">超级管理员</a-tag>
                  <span class="role-actions opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
                    <a-tooltip title="编辑">
                      <a-button class="w-6! h-6! px-0!" type="text" size="small" @click="showEditModal(r)"><EditOutlined /></a-button>
                    </a-tooltip>
                    <a-popconfirm title="确定要删除该角色吗？" ok-text="确定" cancel-text="取消" @confirm="handleDelete(r.id)">
                      <a-tooltip title="删除">
                        <a-button class="w-6! h-6! px-0!" type="text" danger size="small"><DeleteOutlined /></a-button>
                      </a-tooltip>
                    </a-popconfirm>
                  </span>
                </span>
              </div>
              <div class="role-desc">{{ r.description || r.code }}</div>
            </div>
            <a-empty v-if="!loading && filteredRoles.length === 0" description="无匹配角色" />
          </div>
          <div class="shrink-0 px-3 py-2 border-t border-[rgba(15,0,0,0.12)] flex flex-col gap-2">
            <a-pagination
              size="small"
              :current="page.current"
              :page-size="page.pageSize"
              :total="filteredRoles.length"
              :show-size-changer="false"
              @change="onPageChange"
            />
            <a-button type="primary" block @click="showCreateModal()">新增角色</a-button>
            <a-button block :disabled="!selectedRole" @click="showCopyModal()">复制当前角色</a-button>
          </div>
        </div>

        <!-- ===== 右：权限矩阵 ===== -->
        <div class="role-matrix flex-1 min-w-0 min-h-0 flex flex-col">
          <!-- 角色信息（只读） -->
          <div class="shrink-0 px-4 py-3 border-b border-[rgba(15,0,0,0.12)] flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-base font-semibold text-[#201d1d] truncate">{{ selectedRole?.name || '未选择角色' }}</span>
              <a-tag v-if="isAdminRole" color="processing">超级管理员</a-tag>
              <span v-if="selectedRole" class="text-sm text-[#646262]">{{ selectedRole.code }}</span>
            </div>
            <div class="text-sm text-[#646262] truncate">{{ selectedRole ? (selectedRole.description || '（无备注）') : '请在左侧选择角色' }}</div>
          </div>

          <!-- 未选中角色 -->
          <div v-if="!selectedRole" class="flex-1 flex flex-col items-center justify-center gap-2">
            <a-empty description="请先选择左侧角色查看 / 配置权限" />
          </div>

          <template v-else>
            <!-- admin 只读提示 -->
            <div v-if="isAdminRole" class="shrink-0 mx-4 mt-3 px-3 py-2 bg-[#f8f7f7] border border-[rgba(15,0,0,0.12)] text-sm text-[#424245]">
              管理员拥有全部权限，权限矩阵只读。
            </div>

            <!-- 模块 Tab + 表单搜索 -->
            <div class="shrink-0 px-4 pt-2 flex items-center justify-between gap-3 flex-wrap">
              <a-tabs v-model:activeKey="activeTab" size="small" class="mb-0!">
                <a-tab-pane key="all" tab="全部" />
                <a-tab-pane v-for="m in moduleTabs" :key="m.key" :tab="m.name" />
              </a-tabs>
              <a-input v-model:value="formKeyword" placeholder="搜索表单名称" allow-clear class="w-52!" />
            </div>

            <!-- 矩阵主体 -->
            <div class="flex-1 min-h-0 overflow-auto px-4 py-3">
              <a-spin :spinning="matrixLoading">
                <div v-if="filteredGroups.length === 0 && !matrixLoading" class="py-16">
                  <a-empty description="该视图暂无按钮权限项" />
                </div>
                <div v-for="g in filteredGroups" :key="g.moduleId" class="mb-4 last:mb-0!">
                  <!-- 模块分组头（可折叠） -->
                  <div class="flex items-center gap-1.5 cursor-pointer select-none py-1.5" @click="toggleGroup(g.moduleId)">
                    <CaretDownOutlined v-if="!collapsed.has(g.moduleId)" class="text-sm text-[#646262]" />
                    <CaretRightOutlined v-else class="text-sm text-[#646262]" />
                    <span class="text-sm font-semibold text-[#201d1d]">{{ g.moduleName }}</span>
                    <span class="text-sm text-[#646262]">{{ g.rows.length }} 个表单</span>
                  </div>
                  <div v-show="!collapsed.has(g.moduleId)" class="matrix-table">
                    <div v-for="row in g.rows" :key="row.formId" class="matrix-row">
                      <div class="matrix-form-col">
                        <a-checkbox
                          :checked="row.checked"
                          :disabled="isAdminRole"
                          @change="(e: any) => onViewChange(row, e.target.checked)"
                        >
                          <span class="text-sm text-[#646262]">页面</span>
                        </a-checkbox>
                        <span class="form-name">{{ row.formName }}</span>
                      </div>
                      <div class="matrix-btn-col">
                        <a-checkbox
                          v-for="b in row.buttons"
                          :key="b.id"
                          :checked="row.buttonChecked[b.id]"
                          :disabled="isAdminRole"
                          @change="(e: any) => onButtonChange(row, b.id, e.target.checked)"
                        >
                          {{ b.name }}
                        </a-checkbox>
                      </div>
                    </div>
                  </div>
                </div>
              </a-spin>
            </div>

            <!-- 底部操作条 -->
            <div class="shrink-0 px-4 py-2 border-t border-[rgba(15,0,0,0.12)] flex items-center justify-end gap-2">
              <a-button :disabled="isAdminRole" @click="checkAllView(true)">全选</a-button>
              <a-dropdown :disabled="isAdminRole">
                <a-button>
                  快速授权
                  <DownOutlined />
                </a-button>
                <template #overlay>
                  <a-menu @click="onQuickAuth">
                    <a-menu-item key="all">全选当前视图</a-menu-item>
                    <a-menu-item key="clear">清空当前视图</a-menu-item>
                    <a-menu-item key="reset">恢复已保存权限</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
              <a-button type="primary" :loading="saving" :disabled="isAdminRole" @click="handleSavePerm">保存</a-button>
            </div>
          </template>
        </div>
      </div>
    </a-card>

    <!-- 新增/编辑弹窗（原样保留：名称/编码/数据范围/部门/描述；复制角色复用此弹窗） -->
    <a-modal
      :open="modalVisible"
      :title="isEdit ? '编辑角色' : '新增角色'"
      :confirm-loading="modalLoading"
      :mask-closable="!modalLoading" :keyboard="!modalLoading" :closable="!modalLoading"
      :cancel-button-props="{ disabled: modalLoading }" @cancel="closeModal"
      ok-text="保存" cancel-text="取消" @ok="handleSubmit"
    >
      <div ref="feedbackRoot">
      <FormFeedback :items="feedbackItems" :request-id="feedbackRequestId" @focus="feedback.focus" />
      <a-form :model="form" layout="vertical">
        <a-row :gutter="8">
          <a-col :span="12">
            <a-form-item label="角色名称" required data-form-field="name" :validate-status="formErrors.name ? 'error' : undefined">
              <a-input v-model:value="form.name" :disabled="modalLoading" aria-label="角色名称" v-bind="feedback.attrs('name')" placeholder="如：管理员" :maxlength="50" />
              <p v-if="formErrors.name" :id="feedback.errorId('name')" class="field-error">{{ formErrors.name }}</p>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="角色编码" required data-form-field="code" :validate-status="formErrors.code ? 'error' : undefined">
              <a-input
                v-model:value="form.code"
                :disabled="isEdit || modalLoading"
                aria-label="角色编码"
                v-bind="feedback.attrs('code')"
                placeholder="如：admin"
                :maxlength="50"
              />
              <p v-if="formErrors.code" :id="feedback.errorId('code')" class="field-error">{{ formErrors.code }}</p>
              <div class="text-gray-400 text-sm mt-1">编码用于程序判断，创建后不可修改</div>
            </a-form-item>
          </a-col>
          <a-col :span="24">
            <a-form-item label="描述">
              <a-textarea v-model:value="form.description" :disabled="modalLoading" placeholder="选填" :rows="3" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { SearchOutlined, DownOutlined, CaretRightOutlined, CaretDownOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormFeedback } from '@/composables/useFormFeedback'
import { useUnsavedChanges } from '@/composables/useUnsavedChanges'
import {
  getRoles, getRoleMenuIds, createRole, updateRole,
  assignRoleMenus, deleteRole,
  type RoleItem,
} from '@/api/role'
import { getMenuTree, type MenuItem } from '@/api/menu'

// ============ 基础状态 ============
const loading = ref(false)
const roles = ref<RoleItem[]>([])
const selectedRole = ref<RoleItem | null>(null)
const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
// admin（code=admin）矩阵只读
const isAdminRole = computed(() => selectedRole.value?.code === 'admin')

// ============ 左侧角色列表（一次拉全量 + 客户端搜索/分页） ============
const roleKeyword = ref('')
const page = reactive({ current: 1, pageSize: 8 })

const filteredRoles = computed(() => {
  const kw = roleKeyword.value.trim().toLowerCase()
  if (!kw) return roles.value
  return roles.value.filter((r) =>
    r.name.toLowerCase().includes(kw) || (r.code || '').toLowerCase().includes(kw),
  )
})

const pagedRoles = computed(() => {
  const start = (page.current - 1) * page.pageSize
  return filteredRoles.value.slice(start, start + page.pageSize)
})

watch(roleKeyword, () => { page.current = 1 })
watch(filteredRoles, () => {
  const maxPage = Math.max(1, Math.ceil(filteredRoles.value.length / page.pageSize))
  if (page.current > maxPage) page.current = maxPage
})

function onPageChange(p: number) {
  page.current = p
}

async function fetchData() {
  loading.value = true
  try {
    const res = await getRoles({ page: 1, pageSize: 500 })
    roles.value = res.list
    // 编辑/保存后刷新，同步选中角色的最新信息
    const cur = selectedRole.value
    if (cur) {
      const fresh = res.list.find((r) => r.id === cur.id)
      if (fresh) selectedRole.value = fresh
    }
  } finally {
    loading.value = false
  }
}

/** 列表项点击：操作区（编辑/删除）内不触发选中 */
function onRoleItemClick(r: RoleItem, e: MouseEvent) {
  const el = e.target as HTMLElement
  if (el.closest('.role-actions')) return
  selectRole(r)
}

// ============ 权限矩阵 ============
interface MatrixButton {
  id: number
  name: string
  permission?: string | null
}
interface MatrixRow {
  formId: number
  formName: string
  moduleId: number
  moduleName: string
  buttons: MatrixButton[]
  /** 页面入口的可见性 */
  checked: boolean
  buttonChecked: Record<number, boolean>
}

const moduleTree = ref<MenuItem[]>([])
const matrix = ref<MatrixRow[]>([])
/** 角色已分配的菜单 id（getRoleMenuIds 返回，含按钮节点） */
const existingIds = ref<number[]>([])
const matrixLoading = ref(false)
const saving = ref(false)
const activeTab = ref('all')
const formKeyword = ref('')
const collapsed = reactive(new Set<number>())

const moduleTabs = computed(() => moduleTree.value.map((m) => ({ key: String(m.id), id: m.id, name: m.name })))

/** 按钮节点判定：type='button'；树缺 type 字段时以「有 permission 字段」兜底 */
function isButtonNode(n: MenuItem): boolean {
  return n.type === 'button' || (n.type == null && !!n.permission)
}

function buildMatrix() {
  const rows: MatrixRow[] = []
  const pushRow = (node: MenuItem, moduleId: number, moduleName: string) => {
    const buttons = (node.children ?? []).filter(isButtonNode)
    if (buttons.length === 0) return
    rows.push({
      formId: node.id,
      formName: node.name,
      moduleId,
      moduleName,
      buttons: buttons.map((b) => ({ id: b.id, name: b.name, permission: b.permission })),
      checked: existingIds.value.includes(node.id),
      buttonChecked: Object.fromEntries(buttons.map((b) => [b.id, existingIds.value.includes(b.id)])),
    })
  }
  const walk = (nodes: MenuItem[], moduleId: number, moduleName: string) => {
    for (const node of nodes) {
      pushRow(node, moduleId, moduleName)
      const subMenus = (node.children ?? []).filter((c) => !isButtonNode(c))
      if (subMenus.length) walk(subMenus, moduleId, moduleName)
    }
  }
  for (const mod of moduleTree.value) {
    pushRow(mod, mod.id, mod.name)
    walk(mod.children ?? [], mod.id, mod.name)
  }
  matrix.value = rows
}

async function selectRole(role: RoleItem) {
  if (selectedRole.value?.id === role.id) return
  selectedRole.value = role
  activeTab.value = 'all'
  formKeyword.value = ''
  await loadMatrix()
}

/** 并行拉取全量菜单树 + 角色已分配菜单 id */
async function loadMatrix() {
  if (!selectedRole.value) return
  matrixLoading.value = true
  try {
    const [tree, ids] = await Promise.all([
      getMenuTree(),
      getRoleMenuIds(selectedRole.value.id),
    ])
    moduleTree.value = tree
    existingIds.value = ids || []
    buildMatrix()
  } catch { /* */ }
  finally {
    matrixLoading.value = false
  }
}

/** 当前视图（Tab + 表单搜索过滤后的行） */
const currentViewRows = computed(() => {
  const kw = formKeyword.value.trim().toLowerCase()
  return matrix.value.filter((row) => {
    const tabOk = activeTab.value === 'all' || Number(activeTab.value) === row.moduleId
    if (!tabOk) return false
    if (kw && !row.formName.toLowerCase().includes(kw)) return false
    return true
  })
})

/** 按顶级模块分组（保持菜单树顺序） */
const filteredGroups = computed(() => {
  const groups: { moduleId: number; moduleName: string; rows: MatrixRow[] }[] = []
  for (const mod of moduleTree.value) {
    const rows = currentViewRows.value.filter((r) => r.moduleId === mod.id)
    if (rows.length) groups.push({ moduleId: mod.id, moduleName: mod.name, rows })
  }
  return groups
})

function toggleGroup(moduleId: number) {
  if (collapsed.has(moduleId)) collapsed.delete(moduleId)
  else collapsed.add(moduleId)
}

/** 页面入口联动读取权限，关闭入口时清除该行操作权限 */
function onViewChange(row: MatrixRow, checked: boolean) {
  row.checked = checked
  for (const b of row.buttons) {
    if (!checked || b.permission?.endsWith(':view')) row.buttonChecked[b.id] = checked
  }
}

/** 启用操作时同时启用页面和读取权限 */
function onButtonChange(row: MatrixRow, btnId: number, checked: boolean) {
  row.buttonChecked[btnId] = checked
  if (checked) {
    row.checked = true
    for (const b of row.buttons) if (b.permission?.endsWith(':view')) row.buttonChecked[b.id] = true
  } else if (row.buttons.find(b => b.id === btnId)?.permission?.endsWith(':view')) {
    onViewChange(row, false)
  }
}

function checkAllView(checked: boolean) {
  for (const row of currentViewRows.value) {
    onViewChange(row, checked)
    for (const button of row.buttons) row.buttonChecked[button.id] = checked
  }
}

/** 恢复为已保存状态（重新按 existingIds 构建） */
function resetMatrix() {
  buildMatrix()
}

function onQuickAuth(e: any) {
  const key = e?.key
  if (key === 'all') checkAllView(true)
  else if (key === 'clear') checkAllView(false)
  else if (key === 'reset') resetMatrix()
}

/** 收集保存 id：矩阵勾选 + 保留矩阵未覆盖的菜单 + 补全祖先（与旧树保存行为一致） */
function collectSaveIds(): number[] {
  const managed = new Set<number>()
  for (const row of matrix.value) {
    managed.add(row.formId)
    for (const b of row.buttons) managed.add(b.id)
  }
  const ids = new Set<number>()
  // 1. 保留矩阵未管理的菜单（未配置按钮的页面等），防全量替换丢权限
  for (const id of existingIds.value) {
    if (!managed.has(id)) ids.add(id)
  }
  // 2. 矩阵勾选：页面入口（菜单 id）+ 按钮节点 id
  for (const row of matrix.value) {
    if (row.checked) ids.add(row.formId)
    for (const b of row.buttons) {
      if (row.buttonChecked[b.id]) ids.add(b.id)
    }
  }
  // 3. 补全祖先（表单→模块），与旧树弹窗保存行为一致（后端侧边栏亦自动补父）
  const parentMap = new Map<number, number>()
  const walk = (nodes: MenuItem[], parentId: number | null) => {
    for (const n of nodes) {
      if (parentId != null) parentMap.set(n.id, parentId)
      if (n.children?.length) walk(n.children, n.id)
    }
  }
  walk(moduleTree.value, null)
  const withAncestors = new Set<number>()
  for (const id of ids) {
    let cur: number | undefined = id
    let guard = 0
    while (cur != null && guard < 20) {
      withAncestors.add(cur)
      cur = parentMap.get(cur)
      guard += 1
    }
  }
  return [...withAncestors]
}

async function handleSavePerm() {
  if (!selectedRole.value) return
  saving.value = true
  try {
    const ids = collectSaveIds()
    await assignRoleMenus(selectedRole.value.id, ids)
    existingIds.value = ids
    message.success('权限已保存，相关用户需重新登录生效')
    fetchData()
  } catch { /* */ }
  finally {
    saving.value = false
  }
}

// ============ 新增/编辑/复制 ============
const modalVisible = ref(false)
const modalLoading = ref(false)
const isEdit = ref(false)
const form = reactive({ id: 0, name: '', code: '', description: '' })
const feedbackRoot = ref<HTMLElement | null>(null)
const feedback = useFormFeedback({ root: feedbackRoot, fields: () => ({ name: '角色名称', code: '角色编码' }), values: () => ({ name: form.name, code: form.code }) })
const { summary: feedbackItems, requestId: feedbackRequestId, errors: formErrors } = feedback
let baseline = ''
const unsaved = useUnsavedChanges({ active: () => modalVisible.value, dirty: () => JSON.stringify({ ...form }) !== baseline, saving: () => modalLoading.value })
function closeModal() { void unsaved.attempt(() => { modalVisible.value = false; feedback.clear() }) }
function markBaseline() { feedback.clear(); baseline = JSON.stringify({ ...form }) }
function showCreateModal() {
  isEdit.value = false
  form.id = 0
  form.name = ''
  form.code = ''
  form.description = ''
  markBaseline()
  modalVisible.value = true
}

/** 复制角色：只建空角色（不复制权限），复用新增弹窗预填名称/编码 */
function showCopyModal() {
  if (!selectedRole.value) return
  isEdit.value = false
  form.id = 0
  form.name = `${selectedRole.value.name}-副本`
  form.code = `${selectedRole.value.code}_copy`
  form.description = ''
  modalVisible.value = true
}

async function showEditModal(record: any) {
  isEdit.value = true
  form.id = record.id
  form.name = record.name
  form.code = record.code
  form.description = record.description || ''
  markBaseline()
  modalVisible.value = true

}

async function handleSubmit() {
  if (modalLoading.value) return
  const localErrors: Record<string, string> = {}
  if (!form.name.trim()) localErrors.name = '请输入角色名称'
  if (!isEdit.value && !form.code.trim()) localErrors.code = '请输入角色编码'
  if (!(await feedback.validate(localErrors))) return
  modalLoading.value = true
  try {
    const options = { errorFeedback: 'form' } as const
    if (isEdit.value) {
      await updateRole(form.id, {
        name: form.name.trim(),
        description: form.description || undefined,
      }, options)
      message.success('保存成功')
    } else {
      await createRole({
        name: form.name.trim(),
        code: form.code.trim(),
        description: form.description || undefined,
      }, options)
      message.success('创建成功')
    }
    modalVisible.value = false
    fetchData()
  } catch (error) {
    await feedback.capture(error)
  }
  finally { modalLoading.value = false }
}

// ============ 删除 ============
async function handleDelete(id: number) {
  try {
    await deleteRole(id)
    message.success('删除成功')
    if (selectedRole.value?.id === id) {
      selectedRole.value = null
      matrix.value = []
      existingIds.value = []
      moduleTree.value = []
    }
    fetchData()
  } catch { /* */ }
}

// ============ 初始化 ============
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.roles-matrix-card :deep(.ant-card-body) {
  padding: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 角色选择使用细线边框；不使用投影表达选中态。 */
.role-item {
  padding: 8px 10px;
  border-radius: 0;
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.role-item:hover {
  background: #f8f7f7;
}
.role-item-active,
.role-item-active:hover {
  background: var(--color-layer-hover);
  border-color: var(--color-primary);
}
.role-name {
  font-size: 14px;
  font-weight: 600;
  color: #201d1d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-desc {
  font-size: 14px;
  color: #646262;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 权限矩阵（div 网格，动态列） ===== */
.matrix-table {
  border: 1px solid rgba(15,0,0,0.12);
}
.matrix-row {
  display: flex;
  align-items: center;
  gap: 8px 20px;
  padding: 8px 12px;
  border-top: 1px solid rgba(15,0,0,0.12);
}
.matrix-row:first-child {
  border-top: none;
}
.matrix-row:hover {
  background: #f8f7f7;
}
.matrix-form-col {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 150px;
  flex-shrink: 0;
}
.matrix-btn-col {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 20px;
}
.form-name {
  font-size: 14px;
  font-weight: 600;
  color: #201d1d;
}
@media (max-width: 768px) {
  .roles-layout { flex-direction: column; overflow-y: auto; }
  .role-sidebar { width: 100%; max-height: 260px; flex-shrink: 0; border-right: 0; border-bottom: 1px solid var(--color-border-subtle); }
  .role-matrix { flex: 1 0 420px; }
  .matrix-row { align-items: flex-start; flex-direction: column; }
}
</style>
