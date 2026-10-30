<template>
  <a-drawer v-model:open="open" title="个人中心" :width="440" placement="right" :footer="null"
    :closable="!passwordSaving" :mask-closable="!passwordSaving" :keyboard="!passwordSaving">

    <div class="pd-card">
      <div class="pd-title">个人信息</div>
      <div class="pd-avatar-row">
        <a-avatar :size="64" :src="avatarUrl || undefined" class="pd-avatar">
          {{ avatarChar }}
        </a-avatar>
        <div class="pd-avatar-actions">
          <a-upload
            :show-upload-list="false"
            accept="image/*"
            :before-upload="handleAvatarUpload"
            :disabled="passwordSaving"
          >
            <a-button size="small">更换头像</a-button>
          </a-upload>
          <div class="pd-hint">支持 jpg/png/webp，≤2MB</div>
        </div>
      </div>
      <div class="pd-row"><span class="pd-label">姓名</span><span class="pd-value">{{ profile?.displayName || '-' }}</span></div>
      <div class="pd-row"><span class="pd-label">账号</span><span class="pd-value">{{ profile?.username || '-' }}</span></div>
      <div class="pd-row"><span class="pd-label">部门</span><span class="pd-value">{{ profile?.deptName || '-' }}</span></div>
      <div class="pd-row"><span class="pd-label">角色</span><span class="pd-value">{{ profile?.role?.name || '-' }}</span></div>
      <div class="pd-row">
        <span class="pd-label">手机号</span>
        <a-input v-model:value="phone" size="small" class="pd-input" placeholder="未填写" :disabled="passwordSaving" />
      </div>
      <div class="pd-row">
        <span class="pd-label">邮箱</span>
        <a-input v-model:value="email" size="small" class="pd-input" placeholder="未填写" :disabled="passwordSaving" />
      </div>
      <a-button type="primary" size="small" :loading="saving" :disabled="passwordSaving" class="pd-save" @click="saveProfile">保存修改</a-button>
    </div>


    <div class="pd-card">
      <div class="pd-title">安全设置</div>
      <p class="pd-sec-text">修改成功后所有旧会话失效，需要重新登录。新密码至少 3 位。</p>
      <a-form ref="passwordFormRef" :model="passwordForm" layout="vertical" @finish="savePassword">
        <a-form-item label="原密码" name="oldPassword" :rules="[{ required: true, message: '请输入原密码' }]">
          <a-input-password v-model:value="passwordForm.oldPassword" autocomplete="current-password" :disabled="passwordSaving" />
        </a-form-item>
        <a-form-item label="新密码" name="newPassword" :rules="[{ required: true, min: 3, max: 72, message: '新密码为 3—72 位，编码后最多 72 字节' }]">
          <a-input-password v-model:value="passwordForm.newPassword" autocomplete="new-password" :disabled="passwordSaving" />
        </a-form-item>
        <a-form-item label="确认新密码" name="confirmPassword" :dependencies="['newPassword']"
          :rules="[{ required: true, message: '请再次输入新密码' }, { validator: confirmPassword }]">
          <a-input-password v-model:value="passwordForm.confirmPassword" autocomplete="new-password" :disabled="passwordSaving" />
        </a-form-item>
        <div v-if="passwordError" class="pd-password-error" role="alert">{{ passwordError }}</div>
        <a-button type="primary" html-type="submit" :loading="passwordSaving" :disabled="saving">修改密码并重新登录</a-button>
      </a-form>
    </div>

  </a-drawer>
</template>

<script lang="ts" setup>

import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { message } from 'ant-design-vue'
import { useAppStore } from '@/stores/app'
import { uploadAvatar, changeMyPassword, type UserInfo } from '@/api/auth'
import type { FormInstance } from 'ant-design-vue'

const open = defineModel<boolean>('open', { default: false })

const appStore = useAppStore()
const profile = ref<UserInfo | null>(null)
const phone = ref('')
const email = ref('')
const saving = ref(false)
const passwordFormRef = ref<FormInstance>()
const passwordSaving = ref(false)
const passwordError = ref('')
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
function clearPasswords() {
  passwordForm.oldPassword = passwordForm.newPassword = passwordForm.confirmPassword = ''
  passwordError.value = ''
  passwordFormRef.value?.clearValidate()
}
function confirmPassword(_rule: unknown, value: string) {
  return value === passwordForm.newPassword ? Promise.resolve() : Promise.reject(new Error('两次新密码不一致'))
}
watch(open, value => { if (!value) clearPasswords() })
onBeforeUnmount(clearPasswords)
async function savePassword() {
  if (passwordSaving.value) return
  passwordError.value = ''
  if (new TextEncoder().encode(passwordForm.newPassword).length > 72) {
    passwordError.value = '新密码编码后不能超过 72 字节'
    return
  }
  passwordSaving.value = true
  try {
    await changeMyPassword({ ...passwordForm })
    clearPasswords()
    appStore.clearAuth()
    location.href = '/login?reason=password-changed'
  } catch (error) {
    const failure = error as { response?: unknown; code?: string }
    if (!failure?.response && ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(failure?.code || '')) passwordError.value = '网络异常，修改结果尚未确认，请重新登录核对，避免反复提交。'
    // 请求层显示原密码错误或冲突；保留输入供用户修正，不记录密码。
  }
  finally { passwordSaving.value = false }
}

const avatarUrl = computed(() => profile.value?.avatar ?? null)
const avatarChar = computed(
  () => profile.value?.displayName?.charAt(0) || profile.value?.username?.charAt(0)?.toUpperCase() || 'U',
)

async function load() {
  try {
    const p = await appStore.refreshProfile()
    profile.value = p
    phone.value = p.phone ?? ''
    email.value = p.email ?? ''
  } catch { /* 拦截器已提示 */ }
}

async function saveProfile() {
  saving.value = true
  try {
    const p = await appStore.updateProfile({ phone: phone.value.trim() || null, email: email.value.trim() || null })
    profile.value = p
    message.success('已保存')
  } catch { /* 拦截器已提示 */ } finally {
    saving.value = false
  }
}

/** 头像上传（复用通用上传接口 → PATCH /auth/profile 存 avatar） */
async function handleAvatarUpload(file: File) {
  if (file.size > 2 * 1024 * 1024) {
    message.warning('头像图片不能超过 2MB')
    return false
  }
  try {
    const { url } = await uploadAvatar(file)
    const p = await appStore.updateProfile({ avatar: url })
    profile.value = p
    message.success('头像已更新')
  } catch { /* 拦截器已提示 */ }
  return false // 阻止 antd 默认上传行为
}

onMounted(load)
</script>

<style scoped>
/* 全部走令牌：这里的字号、色值、边框原先逐条写死，改主题时整块不跟随。 */
.pd-card {
  background: var(--color-surface);
  border: var(--rule);
  padding: var(--space-3) var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
}
.pd-title {
  font-size: var(--text-aux);
  font-weight: 700;
  color: var(--color-text-primary);
  padding-bottom: var(--space-2);
  margin-bottom: var(--space-2);
  border-bottom: var(--rule);
}
.pd-avatar-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.pd-avatar {
  background: var(--color-primary);
  font-size: 24px;
  flex-shrink: 0;
}
.pd-avatar-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.pd-hint {
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
}
.pd-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}
.pd-label {
  width: 56px;
  font-size: var(--text-aux);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.pd-value {
  font-size: var(--text-aux);
  color: var(--color-text-primary);
}
.pd-input {
  flex: 1;
}
.pd-save {
  margin-top: var(--space-2);
}
.pd-sec-text {
  font-size: var(--text-aux);
  color: var(--color-text-secondary);
  line-height: var(--lh-relaxed);
}
/* 表单错误文字用深一档的红：--color-danger 在暖白底只有 3.5:1，14px 正文不达标。 */
.pd-password-error { color: var(--color-danger-text); margin-bottom: var(--space-3); }
.pd-stat-row {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.pd-stat {
  flex: 1;
  text-align: center;
  border: var(--rule);
  padding: var(--space-2) var(--space-1);
}
.pd-stat-num {
  font-size: var(--text-title);
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.pd-stat-label {
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}
.pd-links {
  display: flex;
  gap: var(--space-4);
  font-size: var(--text-aux);
}
</style>
