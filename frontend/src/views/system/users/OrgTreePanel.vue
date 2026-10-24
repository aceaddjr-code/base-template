<template>
  <div
    class="org-panel"
    :class="{ 'org-panel--collapsed': orgCollapsed }"
    :role="orgCollapsed ? 'button' : undefined"
    :tabindex="orgCollapsed ? 0 : -1"
    @click="orgCollapsed && toggleOrg()"
    @keydown.enter.prevent="orgCollapsed && toggleOrg()"
  >
    <!-- 收起态：窄条开关 -->
    <template v-if="orgCollapsed">
      <a-tooltip title="展开组织架构">
        <MenuUnfoldOutlined class="org-icon-main" />
      </a-tooltip>
      <span class="org-panel-label">组织架构</span>
    </template>

    <!-- 展开态：标题 + 搜索 + 部门树 -->
    <template v-else>
      <div class="org-head">
        <div class="org-title">组织架构</div>
        <div class="flex items-center">
          <a-tooltip title="新增顶级部门">
            <a-button type="text" size="small" @click.stop="openDeptCreate(null)"><PlusOutlined /></a-button>
          </a-tooltip>
          <a-tooltip title="收起组织架构">
            <a-button type="text" size="small" @click.stop="toggleOrg"><MenuFoldOutlined /></a-button>
          </a-tooltip>
        </div>
      </div>
      <a-input
        v-model:value="orgKeyword"
        class="mb-2"
        placeholder="搜索名称或编码"
        allow-clear
        aria-label="搜索组织架构"
        @keydown.esc="onOrgSearchEsc"
      />
      <div v-if="orgSelectedHidden" class="mb-2 px-1">
        <a-tag class="org-selected-tip" closable @close="onSelectedTipClose">列表仍按「{{ orgSelectedName }}」筛选</a-tag>
      </div>
      <a-tree
        v-if="orgTreeVisible.length"
        v-model:selectedKeys="treeSelectedKeys"
        v-model:expandedKeys="orgExpandedKeys"
        block-node
        @select="onTreeSelect"
      >
        <template #title="node">
          <div class="flex items-center justify-between group min-w-0">
            <span class="flex items-center gap-1.5 min-w-0">
              <component :is="node.id === 'all' ? ApartmentOutlined : AppstoreOutlined" class="org-icon-sub" />
              <span class="truncate"><template v-for="(seg, si) in splitHighlight(node.name, orgKeyword)" :key="si"><mark v-if="seg.hit" class="org-hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
              <span class="org-count">({{ node.count }})</span>
            </span>
            <span v-if="node.id !== 'all'" class="hidden group-hover:flex items-center shrink-0">
              <a-tooltip title="添加子部门"><a-button type="text" size="small" class="w-6! h-6! px-0!" @click.stop="openDeptCreate(node)"><PlusOutlined /></a-button></a-tooltip>
              <a-tooltip title="编辑部门"><a-button type="text" size="small" class="w-6! h-6! px-0!" @click.stop="openDeptEdit(node)"><EditOutlined /></a-button></a-tooltip>
              <a-popconfirm title="确定删除该部门？" ok-text="确定" cancel-text="取消" @confirm="handleDeptDelete(node.id)">
                <a-button type="text" size="small" danger class="w-6! h-6! px-0!" @click.stop><DeleteOutlined /></a-button>
              </a-popconfirm>
            </span>
          </div>
        </template>
      </a-tree>
      <div v-else class="org-search-empty" role="status">没有匹配的部门</div>
    </template>
  </div>

  <!-- 部门新增/编辑弹窗（新增与编辑共用；编辑时编码不可改） -->
  <a-modal
    :open="deptModalVisible"
    :title="deptEditId ? '编辑部门' : '新增部门'"
    v-bind="deptModalProps"
    @cancel="closeDeptModal"
    ok-text="保存" cancel-text="取消"
    @ok="handleDeptSubmit"
    width="480px"
  >
    <div :ref="deptFeedbackRoot">
      <FormFeedback :items="deptFeedbackItems" :request-id="deptRequestId" @focus="deptFeedback.focus" />
      <a-form layout="vertical">
        <a-form-item label="上级部门">
          <a-select v-model:value="deptForm.parentId" :disabled="deptModalLoading" placeholder="不选则为顶级部门" allow-clear style="width: 100%">
            <a-select-option v-for="d in deptOptionsFlat" :key="d.id" :value="d.id" :disabled="d.id === deptEditId">{{ d.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="部门名称" required data-form-field="name" :validate-status="deptErrors.name ? 'error' : undefined">
          <a-input v-model:value="deptForm.name" :disabled="deptModalLoading" aria-label="部门名称" v-bind="deptFeedback.attrs('name')" placeholder="如：计划部" :maxlength="50" />
          <p v-if="deptErrors.name" :id="deptFeedback.errorId('name')" class="field-error">{{ deptErrors.name }}</p>
        </a-form-item>
        <a-form-item label="部门编码" required data-form-field="code" :validate-status="deptErrors.code ? 'error' : undefined">
          <a-input v-model:value="deptForm.code" :disabled="!!deptEditId || deptModalLoading" aria-label="部门编码" v-bind="deptFeedback.attrs('code')" placeholder="如：sales" :maxlength="50" />
          <p v-if="deptErrors.code" :id="deptFeedback.errorId('code')" class="field-error">{{ deptErrors.code }}</p>
          <div class="dept-code-note">编码是部门的稳定标识，创建后不可修改</div>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="排序">
              <a-input-number v-model:value="deptForm.sort" :min="0" :disabled="deptModalLoading" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="状态">
              <a-select v-model:value="deptForm.status" :disabled="deptModalLoading" :options="[{ value: 1, label: '启用' }, { value: 0, label: '禁用' }]" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
import { createDepartment, updateDepartment, deleteDepartment, type Department } from '@/api/department'
import { getUsersSimple } from '@/api/user'
import { ApartmentOutlined, AppstoreOutlined, DeleteOutlined, EditOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { searchOrgTree, collectOrgKeys, orgTreeHasKey, splitHighlight } from './org-tree-search'

/**
 * 组织架构侧栏：部门树展示/搜索/折叠 + 部门增删改。
 * 选中与列表筛选由父页面持有（v-model:selectedKeys + select 事件）；
 * 部门数据变化通过 changed 事件交回父页面统一刷新。
 */
const props = defineProps<{ depts: Department[]; selectedKeys?: string[] }>()
const emit = defineEmits<{
  (e: 'update:selectedKeys', keys: string[]): void
  /** 树点击：全部成员 → undefined；部门 → 该部门 id（父页面据此查询） */
  (e: 'select', deptId: number | undefined): void
  /** 部门增删改成功后触发，父页面重新拉取部门与列表 */
  (e: 'changed'): void
}>()

// ============ 折叠 ============
const orgPreference = localStorage.getItem('starter-org-collapsed')
const orgCollapsed = ref(orgPreference === '1' || (orgPreference === null && window.matchMedia('(max-width: 768px)').matches))
function toggleOrg() {
  orgCollapsed.value = !orgCollapsed.value
  localStorage.setItem('starter-org-collapsed', orgCollapsed.value ? '1' : '0')
}

// ============ 树数据 ============
const orgTreeData = ref<any[]>([])
const deptCounts = ref<Record<number, number>>({})
const orgKeyword = ref('')
const orgExpandedKeys = ref<string[]>([])
let orgExpandSnapshot: string[] | null = null
let lastTotalUsers = 0

/** 部门两两建树并按「本部门及以下」口径累加人数 */
function buildOrgTree(totalUsers: number) {
  const nodes = new Map<number, any>()
  for (const d of props.depts) {
    nodes.set(d.id, { id: d.id, key: `dept-${d.id}`, name: d.name, code: d.code, parentId: d.parentId, count: deptCounts.value[d.id] ?? 0, children: [] })
  }
  const roots: any[] = []
  for (const n of nodes.values()) {
    if (n.parentId != null && nodes.has(n.parentId)) nodes.get(n.parentId).children.push(n)
    else roots.push(n)
  }
  // 子部门人数递归累加（与"点部门看本部门及以下"口径一致）
  const accumulate = (n: any): number => {
    let c = n.count
    for (const ch of n.children) c += accumulate(ch)
    n.count = c
    return c
  }
  for (const r of roots) accumulate(r)
  return [{ key: 'all', name: '全部成员', count: totalUsers, children: roots }]
}

function rebuildTree() {
  orgTreeData.value = buildOrgTree(lastTotalUsers)
}

/** 加载部门人数（getUsersSimple，零新接口）并重建树 */
async function loadCounts() {
  try {
    const simple = await getUsersSimple()
    const direct: Record<number, number> = {}
    for (const u of simple) {
      if (u.deptId != null) direct[u.deptId] = (direct[u.deptId] ?? 0) + 1
    }
    deptCounts.value = direct
    lastTotalUsers = simple.length
    rebuildTree()
  } catch { /* 树失败不阻塞列表 */ }
}

/** 用户增删改后由父页面调用，重新统计人数 */
function reload() { void loadCounts() }

onMounted(() => { void loadCounts() })
// 部门列表来自父页面（增删改后刷新），人数口径不变，仅重建树
watch(() => props.depts, rebuildTree)
defineExpose({ reload })

// ============ 树选中 ============
const treeSelectedKeys = ref<string[]>([...(props.selectedKeys ?? ['all'])])
watch(() => props.selectedKeys, (keys) => {
  if (keys && keys.join(',') !== treeSelectedKeys.value.join(',')) treeSelectedKeys.value = [...keys]
})
watch(treeSelectedKeys, (keys) => emit('update:selectedKeys', keys))

/** 树点击：全部成员 → 全量；部门 → 该部门及以下 */
function onTreeSelect(keys: any[]) {
  const key = keys?.[0]
  if (!key) return
  emit('select', key === 'all' ? undefined : Number(String(key).replace('dept-', '')))
}

// ============ 树搜索 ============
const orgTreeVisible = computed(() => searchOrgTree(orgTreeData.value, orgKeyword.value).visible)

// 搜索时自动展开祖先并保留进入搜索前的展开快照；清除搜索或部门增删重建树后按同一口径恢复
watch([orgKeyword, orgTreeData], () => {
  const active = !!orgKeyword.value.trim()
  if (active) {
    if (orgExpandSnapshot === null) orgExpandSnapshot = orgExpandedKeys.value
    const { expandKeys } = searchOrgTree(orgTreeData.value, orgKeyword.value)
    if (expandKeys.length) orgExpandedKeys.value = expandKeys
  } else {
    orgExpandedKeys.value = orgExpandSnapshot ?? collectOrgKeys(orgTreeData.value)
    orgExpandSnapshot = null
  }
})

function onOrgSearchEsc(event: KeyboardEvent) {
  if (event.isComposing) return
  if (orgKeyword.value) orgKeyword.value = ''
}

// 选中部门被搜索隐藏时列表仍按其过滤，明确提示并可一键回到全部成员，不静默切换
const orgSelectedHidden = computed(() => {
  const key = treeSelectedKeys.value[0]
  if (!key || key === 'all' || !orgKeyword.value.trim()) return false
  return !orgTreeHasKey(orgTreeVisible.value, key)
})

const orgSelectedName = computed(() => {
  const key = treeSelectedKeys.value[0]
  const id = key && key !== 'all' ? Number(String(key).replace('dept-', '')) : NaN
  return props.depts.find((d) => d.id === id)?.name ?? ''
})

function onSelectedTipClose(e: MouseEvent) {
  e.preventDefault()
  treeSelectedKeys.value = ['all']
  emit('select', undefined)
}

// ============ 部门新增/编辑 ============
const deptModal = useFormModal<{ name: string; code: string; parentId: number | undefined; status: number; sort: number }, number>({
  fields: () => ({ name: '部门名称', code: '部门编码' }),
  defaults: () => ({ name: '', code: '', parentId: undefined, status: 1, sort: 0 }),
  validate: (form, editId) => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = '请输入部门名称'
    if (editId == null && !form.code.trim()) errors.code = '请输入部门编码'
    return errors
  },
  save: async (form, editId) => {
    if (editId != null) {
      await updateDepartment(editId, { name: form.name.trim(), parentId: form.parentId ?? null, status: form.status, sort: form.sort }, { errorFeedback: 'form' })
    } else {
      await createDepartment({ name: form.name.trim(), code: form.code.trim(), parentId: form.parentId ?? null, status: form.status, sort: form.sort }, { errorFeedback: 'form' })
    }
    message.success('保存成功')
    // 部门增删改后同时重算人数（与原 refreshOrg 口径一致），并通知父页面刷新部门与列表
    void loadCounts()
    emit('changed')
  },
})
const { visible: deptModalVisible, loading: deptModalLoading, editId: deptEditId, form: deptForm, feedback: deptFeedback, modalProps: deptModalProps, bindRoot: deptFeedbackRoot, close: closeDeptModal, submit: handleDeptSubmit } = deptModal
const { summary: deptFeedbackItems, requestId: deptRequestId, errors: deptErrors } = deptFeedback
/** 上级部门选项（组织架构树拉平，排除"全部成员"根） */
const deptOptionsFlat = computed(() => {
  const flat: { id: number; name: string }[] = []
  const walk = (list: any[]) => {
    for (const n of list) {
      if (n.id !== 'all') {
        flat.push({ id: n.id, name: n.name })
        if (n.children?.length) walk(n.children)
      }
    }
  }
  walk(orgTreeData.value)
  return flat
})

function openDeptCreate(parent?: any) {
  deptModal.open(null, { parentId: parent?.id ?? undefined })
}

function openDeptEdit(node: any) {
  const d = props.depts.find((x) => x.id === node.id)
  deptModal.open(node.id, {
    name: d?.name ?? node.name ?? '',
    code: d?.code ?? '',
    parentId: d?.parentId ?? undefined,
    status: d?.status ?? 1,
    sort: d?.sort ?? 0,
  })
}

async function handleDeptDelete(id: number) {
  try {
    await deleteDepartment(id)
    message.success('删除成功')
    void loadCounts()
    emit('changed')
  } catch { /* 拦截器已提示 */ }
}
</script>

<style scoped>
.org-panel {
  width: 232px;
  flex-shrink: 0;
  border-right: var(--rule);
  padding: var(--space-3) 0;
  overflow-y: auto;
}
.org-panel--collapsed {
  width: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
}
.org-panel--collapsed:hover { background: var(--color-layer-01); }
.org-icon-main { color: var(--color-text-secondary); }
.org-panel-label {
  color: var(--color-text-secondary);
  font-size: var(--text-aux);
  margin-top: var(--space-3);
  writing-mode: vertical-rl;
  letter-spacing: 0.2em;
}
.org-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); padding: 0 var(--space-1); }
.org-title { font-size: var(--text-aux); font-weight: 600; color: var(--color-text-primary); }
.org-icon-sub { color: var(--color-text-tertiary); font-size: var(--text-aux); flex-shrink: 0; }
.org-count { color: var(--color-text-secondary); font-size: var(--text-aux); flex-shrink: 0; }

.org-hit {
  background: var(--color-layer-hover);
  color: var(--color-text-primary);
  font-weight: 600;
  border-radius: 2px;
  padding: 0 1px;
}
.org-search-empty {
  color: var(--color-text-tertiary);
  font-size: var(--text-aux);
  text-align: center;
  padding: var(--space-4) 0;
}
.org-selected-tip {
  max-width: 100%;
  white-space: normal;
  word-break: break-all;
}
.dept-code-note { color: var(--color-text-tertiary); font-size: var(--text-aux); margin-top: var(--space-1); }

@media (max-width: 768px) {
  .org-panel {
    width: 100%;
    max-height: min(35vh, 220px);
    border-right: 0;
    border-bottom: var(--rule);
  }
  .org-panel--collapsed {
    flex-direction: row;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .org-panel--collapsed .org-panel-label {
    margin-top: 0;
    writing-mode: horizontal-tb;
    letter-spacing: normal;
  }
}
</style>
