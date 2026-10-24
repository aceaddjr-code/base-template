<template>
  <DetailDrawer
    :open="open"
    :title="`用户详情${detail ? ` · ${detail.displayName || detail.username}` : ''}`"
    :record="detail"
    :fields="[]"
    :loading="false"
    :show-audit-time="false"
    :custom-extra="true"
    @update:open="onRequestClose"
  >
    <!-- 编辑切换按钮：与 DetailDrawer 内置模式同一位置与形态 -->
    <template #extra>
      <template v-if="!editing">
        <a-button :disabled="saving || !detail" @click="startEdit"><EditOutlined /> 编辑</a-button>
      </template>
      <template v-else>
        <a-tag color="processing">编辑中</a-tag>
        <a-button class="mr-2" :disabled="saving" @click="cancelEdit">取消</a-button>
        <a-button type="primary" :loading="saving" @click="saveEdit">保存</a-button>
      </template>
    </template>

    <div :ref="feedbackRoot" class="flex flex-col gap-1">
      <FormFeedback :items="feedbackItems" :request-id="feedbackRequestId" @focus="feedback.focus" />
      <template v-if="detail">
        <!-- 查看/编辑共用同一字段网格，编辑态在原位置切换为输入控件 -->
        <a-descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
          <a-descriptions-item label="登录账号">
            <span class="detail-text">{{ detail.username || '-' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="姓名">
            <div v-if="editing" data-form-field="displayName">
              <a-input v-model:value="form.displayName" :disabled="saving" aria-label="姓名" v-bind="feedback.attrs('displayName')" placeholder="显示姓名" :maxlength="50" />
              <p v-if="errors.displayName" :id="feedback.errorId('displayName')" class="field-error">{{ errors.displayName }}</p>
            </div>
            <span v-else class="detail-text">{{ detail.displayName || '-' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-badge :status="detail.status === 1 ? 'success' : 'error'" :text="detail.status === 1 ? '启用' : '禁用'" />
          </a-descriptions-item>
          <a-descriptions-item label="邮箱">
            <div v-if="editing" data-form-field="email">
              <a-input v-model:value="form.email" :disabled="saving" aria-label="邮箱" v-bind="feedback.attrs('email')" placeholder="选填" :maxlength="100" />
              <p v-if="errors.email" :id="feedback.errorId('email')" class="field-error">{{ errors.email }}</p>
            </div>
            <span v-else class="detail-text">{{ detail.email || '-' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="手机号">
            <div v-if="editing" data-form-field="phone">
              <a-input v-model:value="form.phone" :disabled="saving" aria-label="手机号" v-bind="feedback.attrs('phone')" placeholder="选填" :maxlength="20" />
              <p v-if="errors.phone" :id="feedback.errorId('phone')" class="field-error">{{ errors.phone }}</p>
            </div>
            <span v-else class="detail-text">{{ detail.phone || '-' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="部门">
            <div v-if="editing" data-form-field="deptId">
              <a-select v-model:value="form.deptId" :disabled="saving" aria-label="部门" v-bind="feedback.attrs('deptId')" placeholder="选择部门" allow-clear style="width: 100%">
                <a-select-option v-for="d in depts" :key="d.id" :value="d.id">{{ d.name }}</a-select-option>
              </a-select>
              <p v-if="errors.deptId" :id="feedback.errorId('deptId')" class="field-error">{{ errors.deptId }}</p>
            </div>
            <span v-else class="detail-text">{{ detail.dept?.name || '-' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="直属上级">
            <div v-if="editing" data-form-field="leaderId">
              <a-select
                v-model:value="form.leaderId"
                :disabled="saving"
                aria-label="直属上级"
                v-bind="feedback.attrs('leaderId')"
                placeholder="选择直属上级（可跨部门）"
                allow-clear
                style="width: 100%"
                :options="leaderOptions.filter((o) => o.id !== detail?.id).map((o) => ({ label: formatLeaderOptionLabel(o), value: o.id }))"
              />
              <p v-if="errors.leaderId" :id="feedback.errorId('leaderId')" class="field-error">{{ errors.leaderId }}</p>
              <div class="field-note">用于组织汇报关系，不代表业务审批权限。</div>
            </div>
            <span v-else class="detail-text">{{ leaderName }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="角色">
            <div v-if="editing" data-form-field="roleId">
              <a-select v-model:value="form.roleId" :disabled="saving" aria-label="角色" v-bind="feedback.attrs('roleId')" placeholder="选择角色" allow-clear style="width: 100%">
                <a-select-option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</a-select-option>
              </a-select>
              <p v-if="errors.roleId" :id="feedback.errorId('roleId')" class="field-error">{{ errors.roleId }}</p>
            </div>
            <a-tag v-else>{{ detail.role?.name || '未分配' }}</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="附加角色">
            <div v-if="editing" data-form-field="roleIds">
              <a-select v-model:value="form.roleIds" :disabled="saving" aria-label="附加角色" v-bind="feedback.attrs('roleIds')" mode="multiple" placeholder="可选多个" style="width: 100%">
                <a-select-option v-for="r in roles" :key="r.id" :value="r.id" :disabled="r.id === form.roleId">{{ r.name }}</a-select-option>
              </a-select>
              <p v-if="errors.roleIds" :id="feedback.errorId('roleIds')" class="field-error">{{ errors.roleIds }}</p>
            </div>
            <template v-else>
              <a-tag v-for="name in extraRoleNames" :key="name">{{ name }}</a-tag>
              <span v-if="!extraRoleNames.length">-</span>
            </template>
          </a-descriptions-item>
          <!-- 重设密码只在编辑态出现：查看态不展示空密码占位 -->
          <a-descriptions-item v-if="editing" label="重设密码">
            <div data-form-field="password">
              <a-input-password v-model:value="form.password" :disabled="saving" aria-label="重设密码" v-bind="feedback.attrs('password')" placeholder="留空保持原密码，修改时至少 3 位" :maxlength="72" />
              <p v-if="errors.password" :id="feedback.errorId('password')" class="field-error">{{ errors.password }}</p>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            <span class="detail-text">{{ formatDateTime(detail.createdAt) }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="修改时间">
            <span class="detail-text">{{ formatDateTime(detail.updatedAt) }}</span>
          </a-descriptions-item>
        </a-descriptions>
      </template>
      <a-empty v-else-if="open" description="详情加载失败或记录不可见" />
    </div>
  </DetailDrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
import { formatDateTime } from '@/utils/format'
import { updateUser, type UserItem } from '@/api/user'
import type { RoleOption } from '@/api/role'
import type { Department } from '@/api/department'
import { formatLeaderOptionLabel, useLeaderOptions } from './leader-options'
import { EditOutlined } from '@ant-design/icons-vue'

/**
 * 用户查看/编辑共用抽屉：字段原地切换，保存/取消后留在查看态。
 * 用户接口没有单条详情端点，数据来自列表行快照；保存成功用 updateUser 响应回填查看态。
 * 附加角色多选与重设密码控件超出 DetailDrawer 内置编辑控件集合，字段区在默认插槽自渲染。
 */
const props = defineProps<{ open: boolean; record: UserItem | null; startInEdit?: boolean; depts: Department[]; roles: RoleOption[] }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'updated'): void }>()

const detail = ref<UserItem | null>(null)
const { leaderOptions, loadLeaderOptions } = useLeaderOptions()

interface UserEditForm {
  displayName: string; email: string; phone: string; password: string
  roleId: number | undefined; roleIds: number[]; deptId: number | undefined; leaderId: number | undefined; _origLeaderId: number | undefined
}
const editSession = useFormModal<UserEditForm, number>({
  fields: () => ({ displayName: '姓名', email: '邮箱', phone: '手机号', password: '重设密码', deptId: '部门', leaderId: '直属上级', roleId: '角色', roleIds: '附加角色' }),
  defaults: () => ({ displayName: '', email: '', phone: '', password: '', roleId: undefined, roleIds: [], deptId: undefined, leaderId: undefined, _origLeaderId: undefined }),
  validate: form => (form.password && form.password.length < 3 ? { password: '密码至少 3 位' } : {}),
  save: async (form, userId) => {
    if (!detail.value || userId == null) return
    // 直属上级未变化时不提交该字段，避免误清空服务端汇报关系
    const leaderChanged = form.leaderId !== form._origLeaderId
    const latest = await updateUser(userId, {
      email: form.email || undefined,
      phone: form.phone || undefined,
      roleId: form.roleId ?? null,
      password: form.password || undefined,
      roleIds: form.roleIds,
      displayName: form.displayName || undefined,
      deptId: form.deptId ?? null,
      ...(leaderChanged ? { leaderId: form.leaderId ?? null } : {}),
    }, { errorFeedback: 'form' })
    detail.value = { ...detail.value, ...latest, roleIds: latest.roleIds ?? [...form.roleIds] }
    message.success('保存成功')
    emit('updated')
  },
})
// 抽屉原地编辑：会话可见即编辑中，保存/取消后回到查看态（抽屉保持打开）
const editing = editSession.visible
const saving = editSession.loading
const form = editSession.form
const feedback = editSession.feedback
const feedbackRoot = editSession.bindRoot
const { errors, summary: feedbackItems, requestId: feedbackRequestId } = feedback

/** DetailDrawer 关闭请求经未保存确认后透传给父页面 */
function onRequestClose() { editSession.guard(() => emit('update:open', false)) }

const leaderName = computed(() => {
  if (!detail.value?.leaderId) return '-'
  const leader = leaderOptions.value.find((o) => o.id === detail.value?.leaderId)
  return leader ? formatLeaderOptionLabel(leader) : '-'
})
const extraRoleNames = computed(() =>
  (detail.value?.roleIds ?? []).map((id) => props.roles.find((r) => r.id === id)?.name).filter((n): n is string => !!n),
)

// 切换记录或重开抽屉时重置编辑状态；上一条记录的草稿不带入下一条
watch(
  [() => props.open, () => props.record?.id],
  () => {
    detail.value = props.record ? { ...props.record } : null
    editSession.visible.value = false
    feedback.clear()
    if (props.open && props.record) {
      loadLeaderOptions()
      if (props.startInEdit) startEdit()
    }
  },
  { immediate: true },
)

function startEdit() {
  if (!props.open || !detail.value || saving.value) return
  const row = detail.value
  editSession.open(row.id, {
    displayName: row.displayName || '',
    email: row.email || '',
    phone: row.phone || '',
    password: '',
    roleId: row.role?.id,
    roleIds: (row.roleIds ?? []).filter((x) => x !== row.role?.id),
    deptId: row.deptId ?? undefined,
    leaderId: row.leaderId ?? undefined,
    _origLeaderId: row.leaderId ?? undefined,
  })
}

/** 取消丢弃草稿并按共享 DetailDrawer 口径重读详情：用户无单条端点，列表行快照即最新服务端数据 */
function cancelEdit() {
  editSession.guard(() => {
    editSession.visible.value = false
    feedback.clear()
    detail.value = props.record ? { ...props.record } : null
  })
}

const saveEdit = editSession.submit
</script>

<style scoped>
.detail-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.field-note { color: var(--color-text-tertiary); font-size: var(--text-aux); margin-top: var(--space-1); }
</style>
