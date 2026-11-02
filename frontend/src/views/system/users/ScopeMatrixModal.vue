<template>
  <a-modal
    :open="open"
    :confirm-loading="scopeSaving"
    :mask-closable="!scopeSaving"
    :keyboard="!scopeSaving"
    :closable="!scopeSaving"
    :cancel-button-props="{ disabled: scopeSaving }"
    :ok-button-props="{ disabled: scopeLoading || !loadedUserId || !!loadError }"
    ok-text="保存"
    cancel-text="取消"
    @cancel="emit('update:open', false)"
    @ok="handleScopeSave"
    width="min(1200px, 96vw)"
  >
    <template #title>
      <div class="scope-title flex items-center gap-2">
        <SafetyOutlined class="text-primary" />
        <span>业务数据范围设置 - {{ target?.name ?? '' }}</span>
      </div>
    </template>
    <div class="scope-note">
      每个表单单独设置；未配置时仅本人。部门包含下级部门，操作仍需对应权限码。
    </div>
    <a-alert
      v-if="staleCount"
      type="warning"
      show-icon
      :message="`已忽略 ${staleCount} 条已下线表单的旧配置，保存后将随全量替换清除`"
      class="mb-2"
    />
    <a-alert v-if="loadError" type="error" show-icon :message="loadError" class="mb-3">
      <template #action><a-button size="small" @click="loadScope">重试</a-button></template>
    </a-alert>
    <a-table
      :columns="scopeColumns"
      :data-source="scopeRows"
      :loading="scopeLoading"
      :pagination="false"
      row-key="scopeKey"
      size="small"
      :scroll="{ x: 1140, y: 430 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'scopeType'">
          <div class="flex flex-col gap-1.5">
            <a-radio-group :value="record.scopeType" size="small" :disabled="scopeSaving" @change="changeScopeType(record as ScopeRow, $event.target.value)">
              <a-radio value="self">自己的</a-radio>
              <a-radio value="all">全部</a-radio>
              <a-radio value="by_users">按用户</a-radio>
              <a-radio value="by_depts">按部门</a-radio>
            </a-radio-group>
            <a-select
              v-if="record.scopeType === 'by_users'"
              v-model:value="record.targets"
              :disabled="scopeSaving"
              mode="multiple"
              placeholder="选择用户"
              :options="scopeUserOptions"
              :max-tag-count="'responsive'"
              size="small"
              style="width: 100%"
              show-search
              option-filter-prop="label"
            />
            <a-select
              v-else-if="record.scopeType === 'by_depts'"
              v-model:value="record.targets"
              :disabled="scopeSaving"
              mode="multiple"
              placeholder="选择部门"
              :options="scopeDeptOptions"
              :max-tag-count="'responsive'"
              size="small"
              style="width: 100%"
              show-search
              option-filter-prop="label"
            />
          </div>
        </template>
        <template v-else-if="flagKeys.includes(column.key as FlagKey)">
          <a-checkbox
            :checked="record[column.key as FlagKey]"
            :aria-label="`${record.label}${column.title}`"
            :disabled="scopeSaving"
            @update:checked="record[column.key as FlagKey] = $event"
          />
        </template>
      </template>
    </a-table>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { withEmptyDash } from '@/utils/format'
import {
  getUserDataScopes, saveUserDataScopes, getScopeForms, getUsersSimple,
  type ScopeType, type UserSimple,
} from '@/api/user'
import { getDepartmentsAll, type Department } from '@/api/department'
import { SafetyOutlined } from '@ant-design/icons-vue'

/** 各业务表单独立配置。 */
interface ScopeRow {
  scopeKey: string
  label: string
  scopeType: ScopeType
  viewOthers: boolean
  editOthers: boolean
  deleteOthers: boolean
  targets: number[]
  viewSelf: boolean
  editSelf: boolean
  deleteSelf: boolean
}

const props = defineProps<{ open: boolean; target: { id: number; name: string } | null }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const scopeLoading = ref(false)
const scopeSaving = ref(false)
const loadedUserId = ref<number | null>(null)
const loadError = ref('')
/** 已下线表单仍存的配置行数：展示时忽略，保存后由全量替换清除 */
const staleCount = ref(0)
let loadSequence = 0
const scopeRows = ref<ScopeRow[]>([])
const scopeUsers = ref<UserSimple[]>([])
const scopeDepts = ref<Department[]>([])
const flagKeys = ['viewOthers', 'viewSelf', 'editOthers', 'editSelf', 'deleteOthers', 'deleteSelf'] as const
type FlagKey = typeof flagKeys[number]

const scopeColumns = withEmptyDash([
  { title: '表单', dataIndex: 'label', key: 'label', width: 130 },
  { title: '数据范围', key: 'scopeType', width: 400 },
  { title: '查看他人详情', key: 'viewOthers', width: 110, align: 'center' as const },
  { title: '查看本人详情', key: 'viewSelf', width: 110, align: 'center' as const },
  { title: '编辑他人', key: 'editOthers', width: 100, align: 'center' as const },
  { title: '编辑本人', key: 'editSelf', width: 100, align: 'center' as const },
  { title: '删除他人', key: 'deleteOthers', width: 100, align: 'center' as const },
  { title: '删除本人', key: 'deleteSelf', width: 100, align: 'center' as const },
])

const scopeUserOptions = computed(() =>
  scopeUsers.value.map((u) => ({ value: u.id, label: `${u.displayName || u.username}（${u.username}${u.deptName ? ` · ${u.deptName}` : ''}）` })),
)
const scopeDeptOptions = computed(() => {
  const departments = new Map(scopeDepts.value.map(dept => [dept.id, dept]))
  return scopeDepts.value.map(dept => {
    const names = [dept.name], visited = new Set([dept.id])
    let parent = dept.parentId ? departments.get(dept.parentId) : undefined
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id)
      names.unshift(parent.name)
      parent = parent.parentId ? departments.get(parent.parentId) : undefined
    }
    return { value: dept.id, label: names.join(' / ') }
  })
})

async function loadScope() {
  const sequence = ++loadSequence
  loadedUserId.value = null
  loadError.value = ''
  staleCount.value = 0
  scopeRows.value = []
  if (!props.open || !props.target) return
  const userId = props.target.id
  scopeLoading.value = true
  try {
    const [forms, list, users, depts] = await Promise.all([
      getScopeForms(), getUserDataScopes(userId), getUsersSimple(), getDepartmentsAll(),
    ])
    if (sequence !== loadSequence) return
    scopeRows.value = [
      ...forms.map((m): ScopeRow => ({ scopeKey: m.scopeKey, label: m.label, scopeType: 'self', viewOthers: false, editOthers: false, deleteOthers: false, viewSelf: true, editSelf: true, deleteSelf: true, targets: [] })),
    ]
    scopeUsers.value = users
    scopeDepts.value = depts
    let stale = 0
    for (const item of list) {
      // __global__ 是遗留「所有表单」行，读侧已不回退，展示与保存均跳过
      if (item.scopeKey === '__global__') continue
      const row = scopeRows.value.find(r => r.scopeKey === item.scopeKey)
      if (!row) { stale += 1; continue }
      row.scopeType = item.scopeType
      // 开关缺省值由后端归一化后下发，前端只按回显值渲染
      for (const key of flagKeys) row[key] = item[key] === 1
      row.targets = Array.isArray(item.targets) ? [...item.targets] : []
    }
    staleCount.value = stale
    loadedUserId.value = userId
  } catch {
    if (sequence !== loadSequence) return
    scopeRows.value = []
    staleCount.value = 0
    loadError.value = '数据范围加载失败，请重试后再保存'
  } finally {
    if (sequence === loadSequence) scopeLoading.value = false
  }
}

watch([() => props.open, () => props.target?.id], loadScope, { immediate: true })
onBeforeUnmount(() => { loadSequence++ })

function changeScopeType(row: ScopeRow, type: ScopeRow['scopeType']) {
  if (row.scopeType === type) return
  row.scopeType = type
  row.targets = []
}

function handleScopeSave() {
  if (!props.target || scopeSaving.value || scopeLoading.value || loadError.value || loadedUserId.value !== props.target.id) return
  const sequence = loadSequence
  const userId = loadedUserId.value
  if (scopeRows.value.some(row => (row.scopeType === 'by_users' || row.scopeType === 'by_depts') && !row.targets.length)) {
    message.warning('请为按用户或按部门的数据范围选择目标')
    return
  }
  // 全量保存每个表单的独立配置。
  const rows = scopeRows.value
    .map((r) => ({
      scopeKey: r.scopeKey,
      scopeType: r.scopeType,
      viewOthers: r.viewOthers ? 1 : 0,
      editOthers: r.editOthers ? 1 : 0,
      deleteOthers: r.deleteOthers ? 1 : 0,
      targets: r.targets,
      viewSelf: r.viewSelf ? 1 : 0,
      editSelf: r.editSelf ? 1 : 0,
      deleteSelf: r.deleteSelf ? 1 : 0,
    }))
  scopeSaving.value = true
  saveUserDataScopes(userId, rows)
    .then(() => {
      message.success('数据范围已保存，该用户需重新登录生效')
      if (sequence === loadSequence) emit('update:open', false)
    })
    .catch(() => { /* request 拦截器已提示 */ })
    .finally(() => { scopeSaving.value = false })
}
</script>

<style scoped>
.scope-note { color: var(--color-text-tertiary); font-size: var(--text-aux); margin-bottom: var(--space-2); }
.scope-title { padding-right: var(--space-4); }
</style>
