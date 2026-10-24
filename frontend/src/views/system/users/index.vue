<template>
  <Page class="page-list" title="用户管理" description="组织架构、账号与业务数据范围管理。">
    <div class="users-layout">
      <OrgTreePanel
        ref="orgPanelRef"
        v-model:selected-keys="selectedDeptKey"
        :depts="allDepts"
        @select="applyDeptFilter"
        @changed="() => reloadDepts(true)"
      />

      <div ref="bodyRef" class="users-main">
        <PageToolbar
          :show-search="false"
          :show-create="true"
          create-label="新增用户"
          :menu-items="['columns']"
          :columns="columns"
          :all-columns="allColumns"
          column-settings-key="starter-cols-users-main"
          :resizable="resizable"
          :locked-keys="['action']"
          @create="createVisible = true"
          @update:columns="columns = $event"
        />

        <ListFilters :tags="filterTags" :total="total" :dirty="dirty" :loading="loading" :failed="failed" @apply="apply()" @reset="onFiltersReset" @remove="removeFilter" @retry="fetchUsers">
          <label class="filter-field">关键词<a-input v-model:value="draft.keyword" placeholder="搜索账号或姓名" allow-clear style="width:200px" @press-enter="onSearchEnter" /></label>
          <label class="filter-field">状态<a-select v-model:value="draft.statuses" mode="multiple" :options="userStatusOptions" allow-clear placeholder="全部状态" style="min-width:150px;max-width:240px" /></label>
          <template #more><label class="filter-field">创建时间<a-range-picker v-model:value="draft.created" value-format="YYYY-MM-DD" :presets="filterDatePresets()" style="width:240px" /></label></template>
          <template #views><FilterViews module-key="system-users" :applied="appliedRecord" :sort="sort" :known-fields="['keyword', 'statuses', 'created', 'deptId']" :date-fields="['created']" :disabled="loading" @apply-view="onApplyView" /></template>
        </ListFilters>

        <a-table
          :ref="setTableRef"
          :columns="columns"
          :data-source="users"
          :loading="loading"
          :pagination="false"
          row-key="id"
          size="middle"
          :scroll="{ x: 1270, y: tableScrollY }"
        >
          <template #headerCell="{ column }">
            <span>{{ column.title }}</span>
            <span v-if="column.key !== 'action'" class="resize-handle" @click.stop @mousedown.prevent.stop="(e: any) => resizeStart(String(column.key), e)" />
          </template>
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'displayName'">
              <button type="button" class="row-title" :class="{ 'cell-dash': !record.displayName }" @click="openDetail(record)">{{ record.displayName || '-' }}</button>
            </template>
            <template v-else-if="column.key === 'status'">
              <a-badge :status="record.status === 1 ? 'success' : 'error'" :text="record.status === 1 ? '启用' : '禁用'" />
            </template>
            <template v-else-if="column.key === 'createdAt'">
              {{ formatDate(record.createdAt) }}
            </template>
            <template v-else-if="column.key === 'role'">
              <a-tag>{{ record.role?.name || '未分配' }}</a-tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space :size="2" wrap>
                <a-button v-if="!isSuperAdminUser(record)" type="link" size="small" @click="openDataScope(record)">数据范围</a-button>
                <a-button type="link" size="small" @click="openDetail(record, true)">编辑</a-button>
                <a-popconfirm title="确定要删除该用户吗？" ok-text="确定" cancel-text="取消" @confirm="handleDelete(record.id)">
                  <a-button type="link" danger size="small">删除</a-button>
                </a-popconfirm>
                <a-popconfirm
                  :title="record.status === 1 ? '确定要禁用该用户吗？' : '确定要启用该用户吗？'"
                  ok-text="确定"
                  cancel-text="取消"
                  @confirm="handleToggleStatus(record)"
                >
                  <a-button type="link" size="small" :danger="record.status === 1">{{ record.status === 1 ? '禁用' : '启用' }}</a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
          <template #emptyText><a-empty :description="failed ? '查询失败，请重试' : filterTags.length ? '没有匹配的用户' : '暂无用户'" /></template>
        </a-table>
      </div>
    </div>

    <template #footer>
      <ListFooter :source="stickySource" :pagination="pagination" :total-text="totalText" @change="changePage" @size-change="(_current: number, size: number) => changePage(1, size)" />
    </template>
  </Page>

  <UserCreateModal v-model:open="createVisible" :depts="allDepts" :roles="allRoles" @success="onUserMutated" />
  <UserDetailDrawer v-model:open="detailOpen" :record="detailRecord" :start-in-edit="detailEditRequested" :depts="allDepts" :roles="allRoles" @updated="onUserMutated" />
  <ScopeMatrixModal v-model:open="scopeVisible" :target="scopeTarget" />
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import Page from '@/components/Page.vue'
import PageToolbar from '@/components/PageToolbar.vue'
import ListFilters from '@/components/ListFilters.vue'
import ListFooter from '@/components/ListFooter.vue'
import FilterViews from '@/components/FilterViews.vue'
import OrgTreePanel from './OrgTreePanel.vue'
import UserCreateModal from './UserCreateModal.vue'
import UserDetailDrawer from './UserDetailDrawer.vue'
import ScopeMatrixModal from './ScopeMatrixModal.vue'
import { formatDate, withEmptyDash } from '@/utils/format'
import { filterDatePresets } from '@/utils/filter-dates'
import { deleteUser, getUsers, toggleUserStatus, type UserItem } from '@/api/user'
import { getAllRoles, type RoleOption } from '@/api/role'
import { getDepartmentsAll, type Department } from '@/api/department'
import { useResizableColumns } from '@/composables/useResizableColumns'
import { useListQuery } from '@/composables/useListQuery'
import { useListPage } from '@/composables/useListPage'
import { useTableScrollY } from '@/composables/useTableScrollY'
import { makeOnApplyView } from '@/composables/useSavedFilterViews'
import { useAppStore } from '@/stores/app'

// ============ 基础数据 ============
const appStore = useAppStore()
const allRoles = ref<RoleOption[]>([])
const allDepts = ref<Department[]>([])
const orgPanelRef = ref<InstanceType<typeof OrgTreePanel> | null>(null)

async function fetchRoles() {
  try {
    allRoles.value = await getAllRoles()
    if (!allRoles.value.length) {
      message.warning('角色列表为空或加载失败，请刷新页面重试')
    }
  } catch {
    allRoles.value = []
    message.error('角色列表加载失败，请刷新页面重试')
  }
}

/** 部门增删改后刷新部门与列表；组织树由 OrgTreePanel 随 depts 重建 */
function reloadDepts(withList: boolean) {
  getDepartmentsAll()
    .then((list) => {
      allDepts.value = list
      if (withList) void fetchUsers()
    })
    .catch(() => { /* 拦截器已提示 */ })
}

/** 用户增删改后刷新列表并重算组织树人数 */
function onUserMutated() {
  void fetchUsers()
  orgPanelRef.value?.reload()
}

// ============ 列表查询（筛选/分页） ============
interface UserFilters { keyword: string; statuses: number[]; created?: [string, string]; deptId?: number }
const userFilterDefaults = (): UserFilters => ({ keyword: '', statuses: [], created: undefined, deptId: undefined })
const userStatusOptions = [
  { label: '启用', value: 1 },
  { label: '停用', value: 0 },
]
const { setTableRef, stickySource } = useListPage()
const { draft, applied, dirty, loading, failed, rows: users, total, page, pageSize, sort, refresh: fetchUsers, apply, reset: resetFilters, changePage, onSearchEnter, totalText } = useListQuery<UserFilters, UserItem>({
  key: 'system-users', account: () => appStore.userInfo?.id,
  defaults: userFilterDefaults,
  normalize: query => ({ keyword: query.keyword.trim(), statuses: [...new Set(query.statuses)].sort(), created: query.created?.length === 2 ? [query.created[0], query.created[1]] : undefined, deptId: query.deptId }),
  load: (query, signal) => getUsers({
    page: query.page, pageSize: query.pageSize,
    keyword: query.keyword || undefined,
    status: query.statuses.join(',') || undefined,
    createdAtFrom: query.created?.[0], createdAtTo: query.created?.[1],
    deptId: query.deptId,
  }, signal),
  scrollElement: stickySource,
})

// 表头固定 + body 内部滚动：高度由容器实测，工具栏换行时自动重算
const bodyRef = ref<HTMLElement | null>(null)
const tableScrollY = useTableScrollY(bodyRef)

// ============ 组织树选中 → 部门筛选 ============
const selectedDeptKey = ref<string[]>(['all'])

const deptNameById = computed(() => new Map(allDepts.value.map((d) => [d.id, d.name])))
const filterTags = computed(() => {
  const tags: { key: string; label: string }[] = []
  if (applied.value.deptId != null) tags.push({ key: 'deptId', label: `部门：${deptNameById.value.get(applied.value.deptId) ?? '#' + applied.value.deptId}` })
  if (applied.value.keyword) tags.push({ key: 'keyword', label: `关键词：${applied.value.keyword}` })
  if (applied.value.statuses.length) tags.push({ key: 'statuses', label: `状态：${applied.value.statuses.map((s) => (s === 1 ? '启用' : '停用')).join('、')}` })
  if (applied.value.created) tags.push({ key: 'created', label: `创建时间：${applied.value.created.join(' 至 ')}` })
  return tags
})
function removeFilter(key: string) {
  if (key === 'deptId') selectedDeptKey.value = ['all']
  void apply({ ...applied.value, [key]: key === 'keyword' ? '' : undefined })
}

/** 树选择属于明确查询动作；存在未提交输入时先确认，再随当前输入一并查询 */
function applyDeptFilter(deptId: number | undefined) {
  const run = () => {
    draft.value.deptId = deptId
    void apply()
  }
  if (dirty.value) {
    Modal.confirm({ title: '替换未查询的输入？', content: '选择部门会立即查询，尚未应用的输入将一并应用。', okText: '立即查询', cancelText: '保留输入', onOk: run })
  } else {
    run()
  }
}

/** 应用保存的视图：失效字段提示、排序恢复与默认值补齐走共享处理器；组织树选中在 beforeApply 内同步 */
const onApplyView = makeOnApplyView<UserFilters>({
  sort,
  apply,
  defaults: userFilterDefaults,
  beforeApply: ({ query }) => { selectedDeptKey.value = query.deptId != null ? [`dept-${query.deptId}`] : ['all'] },
})

const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: total.value }))
/** 查询重置回基准条件与第一页，组织树选中同步回到"全部成员" */
function onFiltersReset() {
  selectedDeptKey.value = ['all']
  resetFilters()
}
const appliedRecord = computed(() => ({ ...applied.value }) as Record<string, unknown>)

// ============ 列定义与列宽拖拽 ============
const allColumns = ref(withEmptyDash([
  { title: '登录账号', dataIndex: 'username', key: 'username', width: 100 },
  { title: '姓名', dataIndex: 'displayName', key: 'displayName', width: 100 },
  { title: '手机号', dataIndex: 'phone', key: 'phone', width: 130 },
  { title: '邮箱', dataIndex: 'email', key: 'email', width: 160 },
  { title: '角色', key: 'role', width: 120 },
  { title: '是否管理员', key: 'isAdmin', width: 100, customRender: ({ record }: any) => {
    const isA = isSuperAdminUser(record)
    return h('span', { style: { color: isA ? 'var(--color-success-text)' : 'var(--color-text-tertiary)' } }, isA ? '是' : '否')
  } },
  { title: '部门', key: 'dept', width: 100, customRender: ({ record }: any) => record.dept?.name || '-' },
  { title: '状态', key: 'status', width: 80 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180, customRender: ({ text }: any) => formatDate(text) },
  // 操作列按当前「数据范围/编辑/删除/启停」四个文字链接收紧
  { title: '操作', key: 'action', width: 200, fixed: 'right' as const },
]))
const columns = ref([...allColumns.value])
// v2：操作列由图标按钮改为文字链接并放宽，旧 key 保存的宽度会让操作列被压窄
const { resizeStart, colWidths, setColumnWidth } = useResizableColumns('starter-cols-users-main-width-v2', columns, {
  username: 100, displayName: 100, phone: 130, email: 160, role: 120, dept: 100, isAdmin: 100,
  status: 80, createdAt: 180, action: 200,
})
const resizable = computed(() => ({ colWidths, setColumnWidth }))

// ============ 行操作 ============
/** admin 角色 id（主角色或附加角色命中即视为超级管理员） */
const adminRoleIds = computed(() => allRoles.value.filter((r) => r.code === 'admin').map((r) => r.id))

/** 目标用户是否超级管理员（拥有全部数据权限，不显示数据范围入口） */
function isSuperAdminUser(record: any): boolean {
  if (record.role?.code === 'admin') return true
  return (record.roleIds ?? []).some((id: number) => adminRoleIds.value.includes(id))
}

async function handleDelete(id: number) {
  try {
    await deleteUser(id)
    message.success('删除成功')
    onUserMutated()
  } catch { /* 拦截器已提示 */ }
}

async function handleToggleStatus(record: any) {
  try {
    const res = await toggleUserStatus(record.id)
    message.success(res.status === 1 ? '已启用' : '已禁用')
    onUserMutated()
  } catch { /* 拦截器已提示 */ }
}

// ============ 弹窗/抽屉编排 ============
const createVisible = ref(false)
const detailOpen = ref(false)
const detailRecord = ref<UserItem | null>(null)
const detailEditRequested = ref(false)
const scopeVisible = ref(false)
const scopeTarget = ref<{ id: number; name: string } | null>(null)

/** 姓名/编辑入口打开详情抽屉；编辑入口直接进入编辑态 */
function openDetail(record: any, edit = false) {
  detailRecord.value = record as UserItem
  detailEditRequested.value = edit
  detailOpen.value = true
}

function openDataScope(record: any) {
  scopeTarget.value = { id: record.id, name: record.displayName || record.username }
  scopeVisible.value = true
}

// ============ 初始化 ============
onMounted(() => {
  fetchRoles()
  reloadDepts(false)
})
</script>

<style scoped>
.users-layout {
  height: 100%;
  display: flex;
  min-height: 0;
  min-width: 0;
  background: var(--color-surface);
}
.users-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-left: var(--space-3);
}
.users-main > :deep(.ant-table-wrapper) { min-height: 0; overflow: hidden; }

/* 姓名列按钮：主色文字加 600 字重，悬停/聚焦才出现下划线（与示例列表一致） */
.row-title {
  display: inline-block;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.row-title:hover { color: var(--color-link-hover); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.row-title:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; text-decoration: underline; text-underline-offset: 3px; }
.row-title.cell-dash { font-weight: 400; }

@media (max-width: 768px) {
  .users-layout { flex-direction: column; }
  .users-main { padding-left: 0; }
}
</style>
