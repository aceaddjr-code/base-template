<template>
  <div class="change-password-page">
    <section class="panel">
      <div class="panel-head">
        <span class="panel-mark" aria-hidden="true"><BrandMark :size="18" /></span>
        <div class="panel-title">
          <strong>修改初始密码</strong>
          <span>{{ appStore.siteName }}</span>
        </div>
      </div>

      <div class="panel-body">
        <p class="page-hint">
          账号 <strong>{{ appStore.userInfo?.displayName || appStore.userInfo?.username || '' }}</strong>
          正在使用临时密码，修改完成后才能进入系统；修改成功后需用新密码重新登录。
        </p>

        <p v-if="errorMsg" class="page-error" role="alert">
          <warning-outlined class="page-error-icon" />{{ errorMsg }}
        </p>

        <a-form :model="form" layout="vertical" @finish="submit">
          <a-form-item label="当前密码（临时密码）" name="oldPassword" :validate-status="fieldErrors.oldPassword ? 'error' : undefined">
            <a-input-password
              v-model:value="form.oldPassword"
              size="large"
              placeholder="输入当前临时密码"
              autocomplete="current-password"
              :disabled="loading"
              aria-label="当前密码"
              @input="clearFieldError('oldPassword')"
            />
            <p v-if="fieldErrors.oldPassword" class="field-error">{{ fieldErrors.oldPassword }}</p>
          </a-form-item>
          <a-form-item label="新密码" name="newPassword" :validate-status="fieldErrors.newPassword ? 'error' : undefined">
            <a-input-password
              v-model:value="form.newPassword"
              size="large"
              placeholder="至少 3 位，UTF-8 编码最多 72 字节"
              autocomplete="new-password"
              :disabled="loading"
              aria-label="新密码"
              @input="clearFieldError('newPassword')"
            />
            <p v-if="fieldErrors.newPassword" class="field-error">{{ fieldErrors.newPassword }}</p>
          </a-form-item>
          <a-form-item label="确认新密码" name="confirmPassword" :validate-status="fieldErrors.confirmPassword ? 'error' : undefined">
            <a-input-password
              v-model:value="form.confirmPassword"
              size="large"
              placeholder="再次输入新密码"
              autocomplete="new-password"
              :disabled="loading"
              aria-label="确认新密码"
              @input="clearFieldError('confirmPassword')"
            />
            <p v-if="fieldErrors.confirmPassword" class="field-error">{{ fieldErrors.confirmPassword }}</p>
          </a-form-item>
          <a-form-item class="submit-row">
            <a-button type="primary" html-type="submit" size="large" block :loading="loading" class="submit-button">
              修改密码并重新登录
            </a-button>
          </a-form-item>
        </a-form>

        <div class="panel-foot">
          <a-button type="link" :disabled="loading" @click="exitToLogin">退出登录，稍后再改</a-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { WarningOutlined } from '@ant-design/icons-vue'
import { useAppStore } from '@/stores/app'
import { changeMyPassword } from '@/api/auth'
import BrandMark from '@/components/BrandMark.vue'

/** 待改密受限会话专用页：只提供改密与退出，成功后清会话回登录页（不自动换发会话）。 */
const appStore = useAppStore()
const loading = ref(false)
const errorMsg = ref('')
const fieldErrors = reactive<{ oldPassword?: string; newPassword?: string; confirmPassword?: string }>({})

const form = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })

watch([() => form.value.oldPassword, () => form.value.newPassword, () => form.value.confirmPassword], () => {
  if (errorMsg.value) errorMsg.value = ''
})

function clearFieldError(field: 'oldPassword' | 'newPassword' | 'confirmPassword') {
  if (fieldErrors[field]) delete fieldErrors[field]
}

function validate(): boolean {
  let valid = true
  if (!form.value.oldPassword) { fieldErrors.oldPassword = '请输入当前密码'; valid = false }
  if (Array.from(form.value.newPassword).length < 3) { fieldErrors.newPassword = '新密码至少 3 位'; valid = false }
  else if (new TextEncoder().encode(form.value.newPassword).length > 72) { fieldErrors.newPassword = '新密码 UTF-8 编码最多 72 字节'; valid = false }
  else if (form.value.newPassword === form.value.oldPassword) { fieldErrors.newPassword = '新密码不能与当前密码相同'; valid = false }
  if (form.value.confirmPassword !== form.value.newPassword) { fieldErrors.confirmPassword = '两次输入的新密码不一致'; valid = false }
  return valid
}

async function submit() {
  if (loading.value) return
  errorMsg.value = ''
  delete fieldErrors.oldPassword; delete fieldErrors.newPassword; delete fieldErrors.confirmPassword
  if (!validate()) return
  loading.value = true
  try {
    await changeMyPassword({
      oldPassword: form.value.oldPassword,
      newPassword: form.value.newPassword,
      confirmPassword: form.value.confirmPassword,
    })
    // 成功即清会话回登录页；凭据不写任何持久化
    appStore.clearAuth()
    message.success('密码已修改，请使用新密码重新登录')
    location.href = '/login?reason=password-changed'
  } catch (error: any) {
    const data = error?.response?.data
    // 后端字段级错误（原密码不正确等）映射回表单；其余给出行级提示
    const fieldMap: Record<string, 'oldPassword' | 'newPassword' | 'confirmPassword'> = {}
    if (Array.isArray(data?.fieldErrors)) {
      for (const item of data.fieldErrors as Array<{ path?: string; message?: string }>) {
        const target = fieldMap[item.path ?? '']
        if (target && item.message && !fieldErrors[target]) fieldErrors[target] = item.message
      }
    }
    errorMsg.value = (!Object.keys(fieldErrors).length && (data?.message || error?.message)) || ''
    if (!errorMsg.value && !Object.keys(fieldErrors).length) errorMsg.value = '修改失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function exitToLogin() {
  await appStore.signOut()
}
</script>

<style scoped>
.change-password-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--color-surface);
}
.panel {
  width: 100%;
  max-width: 420px;
  border: var(--rule);
  background: var(--color-surface);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--color-surface-dark);
  color: var(--color-text-on-color);
}
.panel-mark { display: inline-flex; align-items: center; }
.panel-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.panel-title strong { font-size: var(--text-body); font-weight: 700; }
.panel-title span { font-size: var(--text-aux); color: var(--color-text-disabled); overflow-wrap: anywhere; }
.panel-body { padding: var(--space-5); }
.page-hint { margin: 0 0 var(--space-5); font-size: var(--text-aux); line-height: var(--lh-base); color: var(--color-text-secondary); }
.page-error {
  display: flex; align-items: flex-start; gap: var(--space-2);
  margin: 0 0 var(--space-5); padding: var(--space-3);
  border: 1px solid var(--color-danger); border-left-width: 3px;
  background: var(--color-red-10); color: var(--color-danger-text); font-size: var(--text-aux);
}
.page-error-icon { flex: none; padding-top: 4px; }
.field-error { margin: var(--space-1) 0 0; font-size: var(--text-aux); color: var(--color-danger-text); }
.submit-row { margin-top: var(--space-5); margin-bottom: var(--space-3) !important; }
.submit-button { height: 44px; }
.panel-foot { display: flex; justify-content: center; }
@media (max-width: 560px) {
  .change-password-page { padding: var(--space-4); align-items: flex-start; }
}
</style>
