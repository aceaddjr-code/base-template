<template>
  <a-modal
    :open="open"
    :confirm-loading="scopeSaving"
    :mask-closable="!scopeSaving"
    :keyboard="!scopeSaving"
    :closable="!scopeSaving"
    :cancel-button-props="{ disabled: scopeSaving }"
    ok-text="保存"
    cancel-text="取消"
    @cancel="emit('update:open', false)"
    @ok="handleScopeSave"
    width="900px"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <SafetyOutlined class="text-primary" />
        <span>业务数据范围设置 - {{ target?.name ?? '' }}</span>
      </div>
    </template>
    <div class="scope-note">
      未配置的表单继承「所有表单」的数据范围；选择「按用户 / 按部门」后需指定具体目标。
    </div>
    <a-table
      :columns="scopeColumns"
      :data-source="scopeRows"
      :loading="scopeLoading"
      :pagination="false"
      row-key="scopeKey"
      size="small"
      :scroll="{ y: 430 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'scopeType'">
          <div class="flex flex-col gap-1.5">
            <a-radio-group v-model:value="record.scopeType" size="small">
              <a-radio v-if="!record.isGlobal" value="">
                <span class="scope-inherit">继承</span>
              </a-radio>
              <a-radio value="self">自己的</a-radio>
              <a-radio value="all">全部</a-radio>
              <a-radio value="by_users">按用户</a-radio>
              <a-radio value="by_depts">按部门</a-radio>
            </a-radio-group>
            <a-select
              v-if="record.scopeType === 'by_users'"
              v-model:value="record.targets"
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
        <template v-else-if="column.key === 'viewOthers' || column.key === 'editOthers' || column.key === 'deleteOthers'">
          <a-switch
            v-model:checked="record[column.key]"
            size="small"
            :disabled="!record.isGlobal && !record.scopeType"
          />
        </template>
      </template>
    </a-table>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { withEmptyDash } from '@/utils/format'
import {
  getUserDataScopes, saveUserDataScopes, getScopeForms, getUsersSimple,
  type ScopeFormMeta, type ScopeType, type UserSimple,
} from '@/api/user'
import { getDepartmentsAll, type Department } from '@/api/department'
import { SafetyOutlined } from '@ant-design/icons-vue'

/** 可配置表单清单（唯一真相源：后端 scope-form.registry 下发，前端不硬编码） */
const SCOPE_FORM_META = ref<ScopeFormMeta[]>([])

/** 矩阵行：scopeType 为空 = 继承「所有表单」（保存时该行省略，后端全量替换即删除旧配置） */
interface ScopeRow {
  scopeKey: string
  label: string
  isGlobal: boolean
  scopeType: ScopeType | ''
  viewOthers: boolean
  editOthers: boolean
  deleteOthers: boolean
  targets: number[]
}

const props = defineProps<{ open: boolean; target: { id: number; name: string } | null }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const scopeLoading = ref(false)
const scopeSaving = ref(false)
const scopeRows = ref<ScopeRow[]>([])
const scopeUsers = ref<UserSimple[]>([])
const scopeDepts = ref<Department[]>([])

const scopeColumns = withEmptyDash([
  { title: '表单', dataIndex: 'label', key: 'label', width: 130 },
  { title: '数据范围', key: 'scopeType', width: 400 },
  { title: '查看他人详情', key: 'viewOthers', width: 96, align: 'center' as const },
  { title: '编辑他人', key: 'editOthers', width: 90, align: 'center' as const },
  { title: '删除他人', key: 'deleteOthers', width: 90, align: 'center' as const },
])

const scopeUserOptions = computed(() =>
  scopeUsers.value.map((u) => ({ value: u.id, label: u.displayName || u.username })),
)
const scopeDeptOptions = computed(() =>
  scopeDepts.value.map((d) => ({ value: d.id, label: d.name })),
)

onMounted(() => {
  void getScopeForms().then((list) => { SCOPE_FORM_META.value = list || [] }).catch(() => { /* 请求拦截器已提示 */ })
})

// 每次打开按目标用户重建矩阵并回显服务端配置；加载失败保留空矩阵由拦截器提示
watch(
  [() => props.open, () => props.target?.id],
  () => {
    if (!props.open || !props.target) return
    scopeRows.value = [
      { scopeKey: '__global__', label: '所有表单', isGlobal: true, scopeType: 'self', viewOthers: true, editOthers: false, deleteOthers: false, targets: [] },
      ...SCOPE_FORM_META.value.map((m): ScopeRow => ({ scopeKey: m.scopeKey, label: m.label, isGlobal: false, scopeType: '', viewOthers: false, editOthers: false, deleteOthers: false, targets: [] })),
    ]
    scopeLoading.value = true
    Promise.all([getUserDataScopes(props.target.id), getUsersSimple(), getDepartmentsAll()])
      .then(([list, users, depts]) => {
        scopeUsers.value = users
        scopeDepts.value = depts
        // 回显：GET 只返回用户实际配置过的行，未返回的表单保持「继承」
        for (const item of list) {
          const row = scopeRows.value.find((r) => r.scopeKey === item.scopeKey)
          if (!row) continue
          row.scopeType = item.scopeType || ''
          row.viewOthers = item.viewOthers === 1
          row.editOthers = item.editOthers === 1
          row.deleteOthers = item.deleteOthers === 1
          row.targets = Array.isArray(item.targets) ? item.targets : []
        }
      })
      .catch(() => { /* request 拦截器已提示 */ })
      .finally(() => { scopeLoading.value = false })
  },
)

function handleScopeSave() {
  if (!props.target || scopeSaving.value) return
  // 收集全部行：scopeType 为空（继承）的行直接省略（全量替换）
  const rows = scopeRows.value
    .filter((r): r is ScopeRow & { scopeType: ScopeType } => !!r.scopeType)
    .map((r) => ({
      scopeKey: r.scopeKey,
      scopeType: r.scopeType,
      viewOthers: r.viewOthers ? 1 : 0,
      editOthers: r.editOthers ? 1 : 0,
      deleteOthers: r.deleteOthers ? 1 : 0,
      targets: r.targets,
    }))
  scopeSaving.value = true
  saveUserDataScopes(props.target.id, rows)
    .then(() => {
      message.success('数据范围已保存，该用户需重新登录生效')
      emit('update:open', false)
    })
    .catch(() => { /* request 拦截器已提示 */ })
    .finally(() => { scopeSaving.value = false })
}
</script>

<style scoped>
.scope-note { color: var(--color-text-tertiary); font-size: var(--text-aux); margin-bottom: var(--space-2); }
.scope-inherit { color: var(--color-text-tertiary); }
</style>
