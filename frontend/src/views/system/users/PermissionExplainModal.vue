<template>
  <a-modal
    :open="open"
    title="权限效果"
    width="760px"
    :footer="null"
    :body-style="{ maxHeight: '68dvh', overflowY: 'auto' }"
    @update:open="onOpenChange"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <SafetyCertificateOutlined class="text-primary" />
        <span>权限效果 · {{ targetLabel }}</span>
      </div>
    </template>

    <p class="explain-hint">
      以下为按目标用户<b>当前配置重新登录后</b>的预计效果，不读取其现有会话；授权变更后需重新登录才实际生效。
    </p>

    <!-- 查询条件：切换表单或记录即清除旧结果，避免误读 -->
    <div class="query-row">
      <a-select
        v-model:value="scopeKey"
        :options="formOptions"
        :loading="formsLoading"
        placeholder="选择业务表单"
        style="width: 200px"
        :disabled="querying"
        aria-label="业务表单"
        @change="clearResult"
      />
      <a-input
        v-model:value="recordIdText"
        placeholder="记录 ID（可选，仅示例事项支持）"
        style="width: 220px"
        :disabled="querying"
        aria-label="记录 ID"
        @change="clearResult"
      />
      <a-button type="primary" :loading="querying" :disabled="!scopeKey || formsLoading" @click="query">查看效果</a-button>
    </div>

    <a-alert
      v-if="failed"
      type="error"
      show-icon
      class="mb-3"
      message="解释请求失败"
      :description="failMessage"
    >
      <template #action><a-button size="small" danger @click="query">重试</a-button></template>
    </a-alert>

    <a-empty v-else-if="!formsLoading && !formOptions.length" description="暂无已注册的业务表单，无法解释" class="my-6" />

    <a-spin v-if="querying" class="block my-6" />

    <div v-else-if="result" class="explain-body" data-testid="explain-result">
      <p class="meta-line">
        评估时间 {{ formatDateTime(result.evaluatedAt) }} · 会话版本 v{{ result.tokenVersion }}
        · {{ result.configSource.scopeFormLabel }}
        <a-tag v-if="!result.configSource.configured" color="warning">未配置，回退仅本人</a-tag>
      </p>

      <div class="account-line">
        <a-badge :status="result.account.status === 1 ? 'success' : 'error'" :text="result.account.status === 1 ? '账号启用' : '账号已禁用'" />
        <a-tag v-if="result.account.mustChangePassword" color="warning">待改密：受限会话只能改密与登出</a-tag>
      </div>

      <div class="section-title">数据范围（{{ scopeTypeLabel }}）</div>
      <p class="section-text">{{ result.dataScope.description }}</p>
      <p class="section-text switches">
        <span>查看：本人 {{ flagText('viewSelf') }} / 他人 {{ flagText('viewOthers') }}</span>
        <span>编辑：本人 {{ flagText('editSelf') }} / 他人 {{ flagText('editOthers') }}</span>
        <span>删除：本人 {{ flagText('deleteSelf') }} / 他人 {{ flagText('deleteOthers') }}</span>
      </p>
      <p v-if="result.dataScope.targetUsers?.length" class="section-text">指定用户：{{ result.dataScope.targetUsers.map((u) => u.label).join('、') }}</p>
      <p v-if="result.dataScope.targetDepts?.length" class="section-text">指定部门（含下级）：{{ result.dataScope.targetDepts.map((d) => d.label).join('、') }}</p>

      <div class="section-title">操作权限</div>
      <table class="explain-table">
        <thead><tr><th>动作</th><th>权限码</th><th>有效</th><th>来源角色</th></tr></thead>
        <tbody>
          <tr v-for="item in result.operationPermissions" :key="item.action">
            <td>{{ actionLabel(item.action) }}</td>
            <td class="mono">{{ item.permissionCode }}</td>
            <td>
              <a-tag v-if="item.adminException" color="purple">admin 例外</a-tag>
              <a-tag v-else-if="item.effective" color="success">有</a-tag>
              <a-tag v-else color="default">无</a-tag>
            </td>
            <td>
              <template v-if="item.sources.length">
                <a-tag v-for="source in item.sources" :key="source.roleId" :color="source.roleEnabled ? 'blue' : 'default'">
                  {{ source.roleName }}{{ source.roleEnabled ? '' : '（已停用）' }}
                </a-tag>
              </template>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="section-note">菜单可见性与接口权限分属两层，此处解释的是接口权限；按钮入口仍按角色菜单授权展示。</p>

      <template v-if="result.recordEvaluation">
        <div class="section-title">记录级诊断<span v-if="result.record" class="record-meta">（{{ result.record.docNo || `#${result.record.id}` }} {{ result.record.title }} · 归属 {{ result.record.ownerLabel || '无' }}{{ result.record.deleted ? ' · 已删除' : '' }}）</span></div>
        <table class="explain-table">
          <thead><tr><th>动作</th><th>结果</th><th>原因</th></tr></thead>
          <tbody>
            <tr v-for="item in result.recordEvaluation" :key="item.action">
              <td>{{ actionLabel(item.action) }}</td>
              <td>
                <a-tag :color="resultColor(item.result)">{{ resultText(item.result) }}</a-tag>
              </td>
              <td>{{ item.readableReason }}<span v-if="item.reasonCodes.length" class="mono codes">（{{ item.reasonCodes.join(', ') }}）</span></td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="section-note">如需逐条记录解释，请填写记录 ID（当前仅支持示例事项）。</p>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { SafetyCertificateOutlined } from '@ant-design/icons-vue'
import { formatDateTime } from '@/utils/format'
import { explainUserPermissions, getScopeForms, type PermissionExplanation, type ScopeFormMeta, type UserItem } from '@/api/user'

/**
 * 权限效果解释（第二批 03）：纯展示后端裁决结果，前端不复算授权。
 * 目标/表单/记录任一变化即清除旧结果；请求带序号，过期响应直接丢弃。
 */
const props = defineProps<{ open: boolean; target: UserItem | null }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

const targetLabel = computed(() => (props.target ? props.target.displayName || props.target.username : ''))
const forms = ref<ScopeFormMeta[]>([])
const formsLoading = ref(false)
const formOptions = computed(() => forms.value.map((item) => ({ label: item.label, value: item.scopeKey })))
const scopeKey = ref<string | undefined>(undefined)
const recordIdText = ref('')
const querying = ref(false)
const failed = ref(false)
const failMessage = ref('')
const result = ref<PermissionExplanation | null>(null)
let sequence = 0

watch(() => props.open, (open) => {
  if (!open) { clearResult(); recordIdText.value = ''; return }
  sequence += 1
  scopeKey.value = forms.value[0]?.scopeKey
  void loadForms()
}, { immediate: true })

// 目标切换：清空结果，上一用户的结果不得闪现为当前结果
watch(() => props.target?.id, () => {
  if (props.open) clearResult()
})

async function loadForms() {
  formsLoading.value = true
  try {
    forms.value = await getScopeForms()
    if (!forms.value.some((item) => item.scopeKey === scopeKey.value)) scopeKey.value = forms.value[0]?.scopeKey
  } catch { /* 拦截器已提示；空清单走 empty 态 */ forms.value = [] }
  finally { formsLoading.value = false }
}

function clearResult() {
  result.value = null
  failed.value = false
  failMessage.value = ''
}

async function query() {
  if (!props.target || !scopeKey.value) return
  const targetId = props.target.id
  const key = scopeKey.value
  const recordId = recordIdText.value.trim() ? Number(recordIdText.value.trim()) : undefined
  if (recordId !== undefined && (!Number.isSafeInteger(recordId) || recordId <= 0)) {
    failed.value = true
    failMessage.value = '记录 ID 必须是正整数'
    result.value = null
    return
  }
  // 新查询直接接管：旧在途请求凭序号在返回时被丢弃（切换目标/表单/重开都递增序号）
  const ticket = ++sequence
  querying.value = true
  failed.value = false
  try {
    const response = await explainUserPermissions(targetId, { scopeKey: key, recordId })
    if (ticket !== sequence || !props.open || props.target?.id !== targetId) return
    result.value = response
  } catch (error: any) {
    if (ticket !== sequence) return
    result.value = null
    failed.value = true
    failMessage.value = error?.response?.data?.message || error?.message || '请稍后重试'
  } finally {
    if (ticket === sequence) querying.value = false
  }
}

function onOpenChange(value: boolean) {
  emit('update:open', value)
}

const scopeTypeLabels: Record<string, string> = {
  self: '仅本人', all: '全部数据', by_users: '指定用户', by_depts: '指定部门', fallback_self: '未配置回退',
}
const scopeTypeLabel = computed(() => (result.value ? scopeTypeLabels[result.value.dataScope.scopeType] ?? result.value.dataScope.scopeType : ''))
const actionLabels: Record<string, string> = { list: '列表', detail: '详情', update: '编辑', delete: '删除', export: '导出' }
const actionLabel = (action: string) => actionLabels[action] ?? action
const flagText = (flag: string) => (result.value?.dataScope.flags?.[flag] === 1 ? '开' : '关')
const resultColor = (value: string) => (value === 'allowed' ? 'success' : value === 'unsupported' ? 'default' : 'error')
const resultText = (value: string) => (value === 'allowed' ? '允许' : value === 'unsupported' ? '不支持' : '拒绝')
</script>

<style scoped>
.explain-hint { margin: 0 0 var(--space-4); font-size: var(--text-aux); color: var(--color-text-tertiary); line-height: var(--lh-base); }
.query-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4); }
.explain-body { display: flex; flex-direction: column; gap: var(--space-2); }
.meta-line { margin: 0; font-size: var(--text-aux); color: var(--color-text-tertiary); }
.account-line { display: flex; align-items: center; gap: var(--space-2); }
.section-title { margin-top: var(--space-3); font-size: var(--text-aux); font-weight: 600; color: var(--color-text-secondary); letter-spacing: 0.08em; }
.record-meta { font-weight: 400; color: var(--color-text-tertiary); margin-left: var(--space-2); }
.section-text { margin: 0; font-size: var(--text-aux); color: var(--color-text-secondary); }
.switches { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.section-note { margin: var(--space-1) 0 0; font-size: var(--text-aux); color: var(--color-text-tertiary); }
.explain-table { width: 100%; border-collapse: collapse; font-size: var(--text-aux); }
.explain-table th, .explain-table td { border: 1px solid var(--color-border); padding: var(--space-2); text-align: left; vertical-align: top; }
.explain-table th { background: var(--color-surface); color: var(--color-text-secondary); font-weight: 600; }
.mono { font-family: var(--font-mono, monospace); }
.codes { color: var(--color-text-tertiary); }
@media (max-width: 560px) {
  .query-row { flex-direction: column; align-items: stretch; }
  .query-row :deep(.ant-select), .query-row :deep(.ant-input) { width: 100% !important; }
}
</style>
