<template>
  <a-modal
    :open="open"
    :body-style="{ maxHeight: '65dvh', overflowY: 'auto' }"
    v-bind="modalProps"
    @cancel="closeCreate"
    ok-text="确认新增"
    cancel-text="取消"
    @ok="handleCreate"
    width="560px"
  >
    <template #title>
      <div class="flex items-center gap-2">
        <UserAddOutlined class="text-primary" />
        <span>新增用户</span>
      </div>
    </template>
    <div :ref="createFeedbackRoot"><FormFeedback :items="createFeedbackItems" :request-id="createRequestId" @focus="createFeedback.focus" /><a-form :model="createForm" layout="vertical">
      <div class="form-section-title">基础信息</div>
      <a-row :gutter="16">
        <a-col :span="24">
          <a-form-item label="登录账号" required data-form-field="loginid" :validate-status="createErrors.loginid ? 'error' : undefined">
            <a-input v-model:value="createForm.loginid" :disabled="createLoading" aria-label="登录账号" v-bind="createFeedback.attrs('loginid')" placeholder="输入登录账号" :maxlength="50">
              <template #prefix><IdcardOutlined class="prefix-icon" /></template>
            </a-input>
            <p v-if="createErrors.loginid" :id="createFeedback.errorId('loginid')" class="field-error">{{ createErrors.loginid }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="姓名" required data-form-field="displayName" :validate-status="createErrors.displayName ? 'error' : undefined">
            <a-input v-model:value="createForm.displayName" :disabled="createLoading" aria-label="姓名" v-bind="createFeedback.attrs('displayName')" placeholder="显示姓名" :maxlength="50">
              <template #prefix><UserOutlined class="prefix-icon" /></template>
            </a-input>
            <p v-if="createErrors.displayName" :id="createFeedback.errorId('displayName')" class="field-error">{{ createErrors.displayName }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="邮箱" data-form-field="email" :validate-status="createErrors.email ? 'error' : undefined">
            <a-input v-model:value="createForm.email" :disabled="createLoading" aria-label="邮箱" v-bind="createFeedback.attrs('email')" placeholder="选填">
              <template #prefix><MailOutlined class="prefix-icon" /></template>
            </a-input>
            <p v-if="createErrors.email" :id="createFeedback.errorId('email')" class="field-error">{{ createErrors.email }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="手机号" data-form-field="phone" :validate-status="createErrors.phone ? 'error' : undefined">
            <a-input v-model:value="createForm.phone" :disabled="createLoading" aria-label="手机号" v-bind="createFeedback.attrs('phone')" placeholder="选填">
              <template #prefix><PhoneOutlined class="prefix-icon" /></template>
            </a-input>
            <p v-if="createErrors.phone" :id="createFeedback.errorId('phone')" class="field-error">{{ createErrors.phone }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="部门" data-form-field="deptId" :validate-status="createErrors.deptId ? 'error' : undefined">
            <a-select
              v-model:value="createForm.deptId" :disabled="createLoading" aria-label="部门" v-bind="createFeedback.attrs('deptId')"
              placeholder="选择部门"
              allow-clear
              style="width: 100%"
            >
              <a-select-option v-for="d in depts" :key="d.id" :value="d.id">{{ d.name }}</a-select-option>
            </a-select>
            <p v-if="createErrors.deptId" :id="createFeedback.errorId('deptId')" class="field-error">{{ createErrors.deptId }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="直属上级" data-form-field="leaderId" :validate-status="createErrors.leaderId ? 'error' : undefined">
            <a-select
              v-model:value="createForm.leaderId" :disabled="createLoading" aria-label="直属上级" v-bind="createFeedback.attrs('leaderId')"
              placeholder="选择直属上级"
              allow-clear
              style="width: 100%"
              :options="leaderOptions.map((o) => ({ label: formatLeaderOptionLabel(o), value: o.id }))"
            />
            <p v-if="createErrors.leaderId" :id="createFeedback.errorId('leaderId')" class="field-error">{{ createErrors.leaderId }}</p></a-form-item>
        </a-col>
      </a-row>
      <div class="form-section-title">角色权限</div>
      <a-row :gutter="16">
        <a-col :span="24">
          <a-form-item label="角色" data-form-field="roleId" :validate-status="createErrors.roleId ? 'error' : undefined">
            <a-select v-model:value="createForm.roleId" :disabled="createLoading" aria-label="角色" v-bind="createFeedback.attrs('roleId')" placeholder="选择角色" allow-clear style="width: 100%">
              <a-select-option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</a-select-option>
            </a-select>
            <p v-if="createErrors.roleId" :id="createFeedback.errorId('roleId')" class="field-error">{{ createErrors.roleId }}</p></a-form-item>
        </a-col>
        <a-col :span="24">
          <a-form-item label="附加角色" data-form-field="roleIds" :validate-status="createErrors.roleIds ? 'error' : undefined">
            <a-select v-model:value="createForm.roleIds" :disabled="createLoading" aria-label="附加角色" v-bind="createFeedback.attrs('roleIds')" mode="multiple" placeholder="可选多个" style="width: 100%">
              <a-select-option v-for="r in roles" :key="r.id" :value="r.id" :disabled="r.id === createForm.roleId">{{ r.name }}</a-select-option>
            </a-select>
            <p v-if="createErrors.roleIds" :id="createFeedback.errorId('roleIds')" class="field-error">{{ createErrors.roleIds }}</p></a-form-item>
        </a-col>
      </a-row>
    </a-form></div>
  </a-modal>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import FormFeedback from '@/components/FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'
import { createUser } from '@/api/user'
import type { RoleOption } from '@/api/role'
import type { Department } from '@/api/department'
import { formatUserOptionLabel as formatLeaderOptionLabel, useUserOptions } from '@/composables/useUserOptions'
import { IdcardOutlined, MailOutlined, PhoneOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons-vue'

/** 新增用户弹窗：纵向表单（编辑走 UserDetailDrawer，不经过这里）。
 *  初始密码由服务端生成，成功后经 success 事件把一次性凭据交给父页面展示。 */
const props = defineProps<{ open: boolean; depts: Department[]; roles: RoleOption[] }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'success', credential: { temporaryPassword: string; expiresAt: string }): void }>()

// 直属上级候选复用共享用户候选；「leader」是本页业务叫法
const { userOptions: leaderOptions, loadUserOptions: loadLeaderOptions } = useUserOptions()
const createModal = useFormModal<{
  loginid: string; displayName: string; email: string; phone: string
  roleId: number | undefined; roleIds: number[]; deptId: number | undefined; leaderId: number | undefined
}>({
  fields: () => ({ loginid: '登录账号', displayName: '姓名', email: '邮箱', phone: '手机号', deptId: '部门', leaderId: '直属上级', roleId: '角色', roleIds: '附加角色' }),
  defaults: () => ({ loginid: '', displayName: '', email: '', phone: '', roleId: undefined, roleIds: [], deptId: undefined, leaderId: undefined }),
  // 可见性由父页面持有（v-model:open），未保存确认按弹窗实际开合判断
  active: () => props.open,
  validate: form => {
    const errors: Record<string, string> = {}
    if (!form.loginid.trim()) errors.loginid = '请输入登录账号'
    if (!form.displayName.trim()) errors.displayName = '请填写姓名'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = '请输入有效的邮箱地址'
    else if (form.email.length > 100) errors.email = '邮箱不能超过 100 字'
    if (form.phone.length > 20) errors.phone = '手机号不能超过 20 字'
    return errors
  },
  save: async form => {
    const created = await createUser({
      loginid: form.loginid.trim(),
      displayName: form.displayName.trim(),
      email: form.email || undefined,
      phone: form.phone || undefined,
      roleId: form.roleId,
      roleIds: form.roleIds.length ? form.roleIds : undefined,
      deptId: form.deptId,
      leaderId: form.leaderId ?? undefined,
    }, { errorFeedback: 'form' })
    emit('success', { temporaryPassword: created.temporaryPassword, expiresAt: created.expiresAt })
  },
  onClosed: () => emit('update:open', false),
})
const { loading: createLoading, form: createForm, feedback: createFeedback, modalProps, close: closeCreate, submit: handleCreate } = createModal
const { errors: createErrors, summary: createFeedbackItems, requestId: createRequestId } = createFeedback
const createFeedbackRoot = createModal.bindRoot
// 打开时重置表单并拉取直属上级候选；关闭时清空错误反馈
watch(() => props.open, (open) => {
  if (!open) { createFeedback.clear(); return }
  createModal.open()
  loadLeaderOptions()
})
</script>

<style scoped>
.form-section-title {
  font-size: var(--text-aux);
  font-weight: 600;
  color: var(--color-text-tertiary);
  letter-spacing: 0.08em;
  margin-bottom: var(--space-3);
}
.prefix-icon { color: var(--color-text-tertiary); }
</style>
