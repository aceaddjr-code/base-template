<template>
  <Page class="page-list" title="角色管理" description="菜单权限 · 数据范围">
    <div class="page-body">
      <PageToolbar :show-search="false" :show-create="true" create-label="新增角色" @create="showCreateModal()">
        <template #actions>
          <a-button :disabled="!selectedRole" @click="showCopyModal()">复制当前角色</a-button>
        </template>
      </PageToolbar>

      <a-card :bordered="false" class="flex-1 min-h-0">
        <div class="roles-layout">
          <!-- ===== 左：角色列表 ===== -->
          <div class="role-sidebar">
            <div class="role-sidebar-head">
              <span class="sidebar-title">角色列表</span>
              <span class="sidebar-count">共 {{ filteredRoles.length }} 个</span>
            </div>
            <div class="role-sidebar-search">
              <a-input v-model:value="roleKeyword" placeholder="搜索角色名称 / 编码" allow-clear>
                <template #prefix><SearchOutlined /></template>
              </a-input>
            </div>
            <div class="role-list">
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
                    <a-tag v-if="r.code === 'admin'" color="processing" class="m-0!">超级管理员</a-tag>
                    <span class="role-actions opacity-0 group-hover:opacity-100 transition-opacity">
                      <a-button type="link" size="small" @click="showEditModal(r)">编辑</a-button>
                      <a-popconfirm title="确定要删除该角色吗？" ok-text="确定" cancel-text="取消" @confirm="handleDelete(r.id)">
                        <a-button type="link" danger size="small">删除</a-button>
                      </a-popconfirm>
                    </span>
                  </span>
                </div>
                <div class="role-desc">{{ r.description || r.code }}</div>
              </div>
              <a-empty v-if="!loading && filteredRoles.length === 0" :description="failed ? '角色加载失败' : '无匹配角色'">
                <a-button v-if="failed" size="small" @click="fetchData">重试</a-button>
              </a-empty>
              <a-empty v-else-if="loading && roles.length === 0" description="加载中…" />
            </div>
            <div class="role-sidebar-foot">
              <a-pagination
                size="small"
                :current="page.current"
                :page-size="page.pageSize"
                :total="filteredRoles.length"
                :show-size-changer="false"
                @change="onPageChange"
              />
            </div>
          </div>

          <!-- ===== 右：权限矩阵 ===== -->
          <div class="role-matrix">
            <!-- 角色信息（只读） -->
            <div class="matrix-head">
              <div class="flex items-center gap-2 min-w-0">
                <span class="matrix-title truncate">{{ selectedRole?.name || '未选择角色' }}</span>
                <a-tag v-if="isAdminRole" color="processing">超级管理员</a-tag>
                <span v-if="selectedRole" class="matrix-sub">{{ selectedRole.code }}</span>
              </div>
              <div class="matrix-sub truncate">{{ selectedRole ? (selectedRole.description || '（无备注）') : '请在左侧选择角色查看 / 配置权限' }}</div>
            </div>

            <!-- 未选中角色 -->
            <div v-if="!selectedRole" class="flex-1 flex flex-col items-center justify-center gap-2">
              <a-empty description="请先选择左侧角色查看 / 配置权限" />
            </div>

            <template v-else>
              <!-- admin 只读提示 -->
              <div v-if="isAdminRole" class="admin-notice">
                管理员拥有全部权限，权限矩阵只读。
              </div>

              <!-- 模块 Tab + 表单搜索 -->
              <div class="matrix-tabs">
                <a-tabs v-model:activeKey="activeTab" size="small" class="mb-0!">
                  <a-tab-pane key="all" tab="全部" />
                  <a-tab-pane v-for="m in moduleTabs" :key="m.key" :tab="m.name" />
                </a-tabs>
                <a-input v-model:value="formKeyword" placeholder="搜索表单名称" allow-clear class="w-52!" />
              </div>

              <!-- 矩阵主体 -->
              <div class="matrix-scroll">
                <a-spin :spinning="matrixLoading">
                  <div v-if="filteredGroups.length === 0 && !matrixLoading" class="py-16">
                    <a-empty :description="matrixFailed ? '权限加载失败' : '该视图暂无按钮权限项'">
                      <a-button v-if="matrixFailed" size="small" @click="loadMatrix">重试</a-button>
                    </a-empty>
                  </div>
                  <div v-for="g in filteredGroups" :key="g.moduleId" class="mb-4 last:mb-0!">
                    <!-- 模块分组头（可折叠） -->
                    <div class="matrix-group" @click="toggleGroup(g.moduleId)">
                      <CaretDownOutlined v-if="!collapsed.has(g.moduleId)" class="group-caret" />
                      <CaretRightOutlined v-else class="group-caret" />
                      <span class="group-name">{{ g.moduleName }}</span>
                      <span class="group-count">{{ g.rows.length }} 个表单</span>
                    </div>
                    <div v-show="!collapsed.has(g.moduleId)" class="matrix-table">
                      <div v-for="row in g.rows" :key="row.formId" class="matrix-row">
                        <div class="matrix-form-col">
                          <a-checkbox
                            :checked="row.checked"
                            :disabled="isAdminRole"
                            @change="(e: any) => toggleFormChecked(row, e.target.checked)"
                          >
                            <span class="matrix-sub">页面</span>
                          </a-checkbox>
                          <span class="form-name">{{ row.formName }}</span>
                        </div>
                        <div class="matrix-btn-col">
                          <a-checkbox
                            v-for="b in row.buttons"
                            :key="b.id"
                            :checked="row.buttonChecked[b.id]"
                            :disabled="isAdminRole"
                            @change="(e: any) => toggleButtonChecked(row, b.id, e.target.checked)"
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
              <div class="matrix-foot">
                <a-button :disabled="isAdminRole" @click="setRowsChecked(currentViewRows, true)">全选</a-button>
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
    </div>

    <!-- 新增/编辑弹窗（原样保留：名称/编码/描述；复制角色复用此弹窗） -->
    <a-modal
      :open="modalVisible"
      :title="isEdit ? '编辑角色' : '新增角色'"
      v-bind="modalProps"
      @cancel="closeModal"
      ok-text="保存" cancel-text="取消" @ok="handleSubmit"
    >
      <div :ref="feedbackRoot">
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
              <div class="field-hint">编码用于程序判断，创建后不可修改</div>
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
  </Page>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { SearchOutlined, DownOutlined, CaretRightOutlined, CaretDownOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
import {
  getRoles, getRoleMenuIds, createRole, updateRole,
  assignRoleMenus, deleteRole,
  type RoleItem,
} from '@/api/role'
import { getMenuTree, type MenuItem } from '@/api/menu'
import { buildPermissionMatrix, collectSaveIds, setRowsChecked, toggleButtonChecked, toggleFormChecked, type MatrixRow } from './permission-matrix'

// ============ 基础状态 ============
const loading = ref(false)
const failed = ref(false)
const roles = ref<RoleItem[]>([])
const selectedRole = ref<RoleItem | null>(null)
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
  failed.value = false
  try {
    const res = await getRoles({ page: 1, pageSize: 500 })
    roles.value = res.list
    // 编辑/保存后刷新，同步选中角色的最新信息
    const cur = selectedRole.value
    if (cur) {
      const fresh = res.list.find((r) => r.id === cur.id)
      if (fresh) selectedRole.value = fresh
    }
  } catch {
    failed.value = true
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
const moduleTree = ref<MenuItem[]>([])
const matrix = ref<MatrixRow[]>([])
/** 角色已分配的菜单 id（getRoleMenuIds 返回，含按钮节点） */
const existingIds = ref<number[]>([])
const matrixLoading = ref(false)
const matrixFailed = ref(false)
const saving = ref(false)
const activeTab = ref('all')
const formKeyword = ref('')
const collapsed = reactive(new Set<number>())

const moduleTabs = computed(() => moduleTree.value.map((m) => ({ key: String(m.id), id: m.id, name: m.name })))

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
  matrixFailed.value = false
  try {
    const [tree, ids] = await Promise.all([
      getMenuTree(),
      getRoleMenuIds(selectedRole.value.id),
    ])
    moduleTree.value = tree
    existingIds.value = ids || []
    matrix.value = buildPermissionMatrix(moduleTree.value, existingIds.value)
  } catch {
    matrixFailed.value = true
  }
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

/** 恢复为已保存状态（重新按 existingIds 构建） */
function resetMatrix() {
  matrix.value = buildPermissionMatrix(moduleTree.value, existingIds.value)
}

function onQuickAuth(e: any) {
  const key = e?.key
  if (key === 'all') setRowsChecked(currentViewRows.value, true)
  else if (key === 'clear') setRowsChecked(currentViewRows.value, false)
  else if (key === 'reset') resetMatrix()
}

async function handleSavePerm() {
  if (!selectedRole.value) return
  saving.value = true
  try {
    const ids = collectSaveIds(matrix.value, existingIds.value, moduleTree.value)
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
const roleModal = useFormModal<{ name: string; code: string; description: string }, number>({
  fields: () => ({ name: '角色名称', code: '角色编码' }),
  defaults: () => ({ name: '', code: '', description: '' }),
  validate: (form, editId) => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = '请输入角色名称'
    if (editId == null && !form.code.trim()) errors.code = '请输入角色编码'
    return errors
  },
  save: async (form, editId) => {
    const options = { errorFeedback: 'form' } as const
    if (editId != null) {
      await updateRole(editId, { name: form.name.trim(), description: form.description || undefined }, options)
      message.success('保存成功')
    } else {
      await createRole({ name: form.name.trim(), code: form.code.trim(), description: form.description || undefined }, options)
      message.success('创建成功')
    }
    fetchData()
  },
})
const { visible: modalVisible, loading: modalLoading, editId, form, feedback, modalProps, close: closeModal, submit: handleSubmit } = roleModal
const isEdit = computed(() => editId.value != null)
const { summary: feedbackItems, requestId: feedbackRequestId, errors: formErrors } = feedback
const feedbackRoot = roleModal.bindRoot
function showCreateModal() { roleModal.open() }

/** 复制角色：只建空角色（不复制权限），复用新增弹窗预填名称/编码 */
function showCopyModal() {
  if (!selectedRole.value) return
  roleModal.open(null, { name: `${selectedRole.value.name}-副本`, code: `${selectedRole.value.code}_copy` })
}

function showEditModal(record: any) {
  roleModal.open(record.id, { name: record.name, code: record.code || '', description: record.description || '' })
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
/* 布局外壳：Page 内容区 100% 高，工具栏在上、左右分栏在下共享纵向空间 */
.page-body { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.roles-layout { flex: 1; min-height: 0; display: flex; }

/* ===== 左：角色列表 ===== */
.role-sidebar { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; border-right: var(--rule); }
.role-sidebar-head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-3) var(--space-2); }
.sidebar-title { font-size: var(--text-aux); font-weight: 600; color: var(--color-text-primary); }
.sidebar-count { font-size: var(--text-aux); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.role-sidebar-search { flex-shrink: 0; padding: 0 var(--space-3); }
.role-list { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-2) 6px; }
.role-sidebar-foot { flex-shrink: 0; padding: var(--space-2) var(--space-3); border-top: var(--rule); }

/* 角色选择使用细线边框；不使用投影表达选中态。 */
.role-item {
  padding: var(--space-2) 10px;
  border-radius: 0;
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.role-item:hover {
  background: var(--color-layer-hover);
}
.role-item-active,
.role-item-active:hover {
  background: var(--color-layer-hover);
  border-color: var(--color-primary);
}
.role-name {
  font-size: var(--text-aux);
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-desc {
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.role-actions { display: flex; align-items: center; }

/* ===== 右：权限矩阵 ===== */
.role-matrix { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.matrix-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--rule);
}
.matrix-title { font-size: var(--text-heading); font-weight: 600; color: var(--color-text-primary); }
.matrix-sub { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.admin-notice {
  flex-shrink: 0;
  margin: var(--space-3) var(--space-4) 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-layer-01);
  border: var(--rule);
  font-size: var(--text-aux);
  color: var(--color-text-secondary);
}
.matrix-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-4) 0;
}
.matrix-scroll { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) var(--space-4); }
.matrix-group { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; padding: 6px 0; }
.group-caret { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.group-name { font-size: var(--text-aux); font-weight: 600; color: var(--color-text-primary); }
.group-count { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.matrix-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-top: var(--rule);
}

/* ===== 矩阵网格（div 网格，动态列） ===== */
.matrix-table { border: var(--rule); }
.matrix-row {
  display: flex;
  align-items: center;
  gap: var(--space-2) 20px;
  padding: var(--space-2) var(--space-3);
  border-top: var(--rule);
}
.matrix-row:first-child { border-top: none; }
.matrix-row:hover { background: var(--color-layer-hover); }
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
  gap: var(--space-1) 20px;
}
.form-name {
  font-size: var(--text-aux);
  font-weight: 600;
  color: var(--color-text-primary);
}

/* 弹窗字段提示（替代 text-gray-400 硬编码灰） */
.field-hint { margin-top: var(--space-1); font-size: var(--text-aux); color: var(--color-text-tertiary); }

@media (max-width: 768px) {
  .roles-layout { flex-direction: column; overflow-y: auto; }
  .role-sidebar { width: 100%; max-height: 260px; flex-shrink: 0; border-right: 0; border-bottom: var(--rule); }
  .role-matrix { flex: 1 0 420px; }
  .matrix-row { align-items: flex-start; flex-direction: column; }
}
</style>
