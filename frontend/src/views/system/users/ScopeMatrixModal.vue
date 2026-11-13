<template>
  <a-modal
    :open="open"
    :confirm-loading="scopeSaving"
    :mask-closable="!scopeSaving"
    :keyboard="!scopeSaving"
    :closable="!scopeSaving"
    :cancel-button-props="{ disabled: scopeSaving }"
    :ok-button-props="{ disabled: scopeLoading || copyLoading || !loadedUserId || !!loadError }"
    ok-text="保存"
    cancel-text="取消"
    @cancel="emit('update:open', false)"
    @ok="handleScopeSave"
    width="min(760px, 96vw)"
  >
    <template #title>
      <div class="scope-title flex items-center gap-2">
        <SafetyOutlined class="text-primary" />
        <span>可见范围 · {{ target?.name ?? '' }}</span>
      </div>
    </template>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <a-select v-model:value="copyUserId" :options="copyUserOptions" show-search option-filter-prop="label" placeholder="选择复制来源" style="width: 260px" :disabled="scopeLoading || scopeSaving || copyLoading" />
      <a-button class="copy-scope" :disabled="!copyUserId || scopeLoading || scopeSaving || copyLoading || !!loadError" :loading="copyLoading" @click="copyScope">复制范围配置</a-button>
    </div>
    <a-alert
      v-if="hasLegacyRestrictions"
      type="warning"
      show-icon
      class="mb-2"
      message="该用户仍有旧操作限制。保存后，范围内的操作按角色权限重新判断。"
    />
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
      :scroll="{ x: 460, y: 430 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'scopeType'">
          <div class="flex flex-col gap-1.5">
            <a-radio-group :value="record.scopeType" size="small" :disabled="scopeSaving || copyLoading" @change="changeScopeType(record as ScopeRow, $event.target.value)">
              <a-radio value="self">仅本人</a-radio>
              <a-radio value="all">全部</a-radio>
              <a-radio value="by_users">按用户</a-radio>
              <a-radio value="by_depts">按部门</a-radio>
            </a-radio-group>
            <a-select
              v-if="record.scopeType === 'by_users'"
              v-model:value="record.targets"
              :disabled="scopeSaving || copyLoading"
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
              :disabled="scopeSaving || copyLoading"
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
  targets: number[]
}

const props = defineProps<{ open: boolean; target: { id: number; name: string } | null }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const scopeLoading = ref(false)
const scopeSaving = ref(false)
const copyLoading = ref(false)
const copyUserId = ref<number | undefined>()
const loadedUserId = ref<number | null>(null)
const loadError = ref('')
/** 已下线表单仍存的配置行数：展示时忽略，保存后由全量替换清除 */
const staleCount = ref(0)
const hasLegacyRestrictions = ref(false)
let loadSequence = 0
const scopeRows = ref<ScopeRow[]>([])
const scopeUsers = ref<UserSimple[]>([])
const scopeDepts = ref<Department[]>([])
const scopeColumns = withEmptyDash([
  { title: '表单', dataIndex: 'label', key: 'label', width: 130 },
  { title: '可见范围', key: 'scopeType' },
])

const scopeUserOptions = computed(() =>
  scopeUsers.value.map((u) => ({ value: u.id, label: `${u.displayName || u.username}（${u.username}${u.deptName ? ` · ${u.deptName}` : ''}）` })),
)
const copyUserOptions = computed(() => scopeUserOptions.value.filter(user => user.value !== props.target?.id))

async function copyScope() {
  if (!copyUserId.value || !props.target || !loadedUserId.value || copyLoading.value) return
  const sequence = loadSequence
  const targetId = props.target.id
  copyLoading.value = true
  try {
    const source = await getUserDataScopes(copyUserId.value)
    if (sequence !== loadSequence || props.target?.id !== targetId) return
    for (const row of scopeRows.value) {
      const item = source.find(entry => entry.scopeKey === row.scopeKey)
      row.scopeType = item?.scopeType ?? 'self'
      row.targets = item?.targets ? [...item.targets] : []
    }
    message.success('已复制，请检查后保存')
  } catch {
    message.warning('复制失败，请重试')
  } finally {
    copyLoading.value = false
  }
}
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
  hasLegacyRestrictions.value = false
  copyUserId.value = undefined
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
      ...forms.map((m): ScopeRow => ({ scopeKey: m.scopeKey, label: m.label, scopeType: 'self', targets: [] })),
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
      if (item.legacyRestricted) hasLegacyRestrictions.value = true
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
  if (!props.target || scopeSaving.value || scopeLoading.value || copyLoading.value || loadError.value || loadedUserId.value !== props.target.id) return
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
      targets: r.targets,
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
.scope-title { padding-right: var(--space-4); }
</style>
