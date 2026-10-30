<template>

  <div class="login-page">
    <!-- ===== 左：深色终端式欢迎区 ===== -->
    <section class="login-brand">
      <div class="brand-mark">
        <span class="brand-logo" aria-hidden="true"><BrandMark :size="18" /></span>
        <div class="brand-text">
          <strong>{{ appName }}</strong>
          <span>{{ appSubtitle }}</span>
        </div>
      </div>

      <!-- 各项目按需替换本段文案（h1 第二行是主色高亮部分） -->
      <div class="brand-body">
        <p class="brand-eyebrow">[ 企业工作台 ]</p>
        <h1>企业管理工作台<br /><em>统一工作入口</em></h1>
        <div class="brand-rule"></div>
        <p class="brand-desc">账号按角色与数据范围授权，关键操作全程留痕可追溯。</p>
        <ul class="brand-points">
          <li>按角色与数据范围授权</li>
          <li>关键操作落库留痕</li>
          <li>菜单由后端按账号下发</li>
        </ul>
      </div>

      <div class="brand-foot">
        <span class="foot-item"><i class="foot-dot"></i>本地账号</span>
        <span class="foot-item">v{{ appVersion }}</span>
      </div>
    </section>

    <!-- ===== 右：登录表单 ===== -->
    <section class="login-form">
      <div class="form-inner">
        <h2>账号登录</h2>
        <p class="form-hint">使用管理员分配的账号登录。</p>
        <p v-if="route.query.reason === 'password-changed'" class="form-hint" role="status">密码已修改，旧会话已失效，请使用新密码重新登录。</p>

        <p v-if="errorMsg" class="form-error" role="alert">
          <warning-outlined class="form-error-icon" />{{ errorMsg }}
        </p>

        <a-form :model="form" layout="vertical" @finish="handleLogin">
          <a-form-item name="username" label="用户名" :rules="[{ required: true, message: '请输入用户名' }]">
            <a-input
              v-model:value="form.username"
              size="large"
              placeholder="请输入用户名"
              autocomplete="username"
              autofocus
              :disabled="loading"
            />
          </a-form-item>
          <a-form-item name="password" label="密码" :rules="[{ required: true, message: '请输入密码' }]">
            <a-input-password
              v-model:value="form.password"
              size="large"
              placeholder="请输入密码"
              autocomplete="current-password"
              :disabled="loading"
            />
          </a-form-item>
          <a-form-item class="form-submit">
            <a-button type="primary" html-type="submit" block size="large" :loading="loading" class="login-submit">
              登录
            </a-button>
          </a-form-item>
        </a-form>

        <p class="form-foot">忘记密码请联系系统管理员重置，登录失败原因会显示在上方。</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { WarningOutlined } from '@ant-design/icons-vue'
import { useAppStore } from '@/stores/app'
import BrandMark from '@/components/BrandMark.vue'
import { APP_VERSION } from '@/version'

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const loading = ref(false)
const errorMsg = ref('')
const appName = import.meta.env.VITE_APP_NAME || '企业管理系统'
const appSubtitle = import.meta.env.VITE_APP_SUBTITLE || 'Enterprise Management System'
const appVersion = APP_VERSION

const form = ref({
  username: '',
  password: '',
})

// 用户一旦开始修改，上一条失败原因就已过期，立即撤掉，避免旧提示误导
watch(
  [() => form.value.username, () => form.value.password],
  () => {
    if (errorMsg.value) errorMsg.value = ''
  },
)

async function handleLogin() {
  errorMsg.value = ''
  loading.value = true
  try {
    await appStore.signIn({
      loginid: form.value.username,
      password: form.value.password,
    })
    message.success('登录成功')
    const redirect = (route.query.redirect as string) || ''
    const target = redirect && redirect.startsWith('/') ? redirect : '/'
    router.push(target)
  } catch (error: any) {
    // 密码错误 / 账号锁定 / 网络错误等一律给出可见反馈
    errorMsg.value = error?.response?.data?.message || error?.message || '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 100dvh;
  background: var(--color-surface);
}

/* ===== 深色欢迎区：与首页终端区同一块反白面板 ===== */
.login-brand {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6);
  background: var(--color-surface-dark);
  color: var(--color-text-on-color);
  border-right: var(--rule);
}
.brand-mark { display: flex; align-items: center; gap: var(--space-3); }
.brand-logo {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--color-text-on-color);
  color: var(--color-surface-dark);
  font-size: var(--text-aux);
  font-weight: 700;
  line-height: 1;
}
.brand-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.brand-text strong { font-size: var(--text-aux); font-weight: 700; }
.brand-text span { color: var(--color-text-disabled); font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; overflow-wrap: anywhere; }

.brand-body { margin: auto 0; }
.brand-eyebrow { margin: 0 0 var(--space-5); font-size: var(--text-aux); color: var(--color-text-disabled); letter-spacing: 0.04em; }
.brand-body h1 { margin: 0; font-size: var(--text-display); font-weight: 700; line-height: var(--lh-tight); }
.brand-body h1 em { font-style: normal; color: var(--color-text-on-color); }
.brand-rule { height: 1px; background: var(--color-border-strong); margin: var(--space-5) 0; }
.brand-desc { margin: 0; font-size: var(--text-body); line-height: var(--lh-base); color: var(--color-text-disabled); }
.brand-points { margin: var(--space-5) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.brand-points li { display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--text-aux); color: var(--color-text-disabled); }
.brand-points li::before { content: ''; flex: none; width: 4px; height: 4px; background: var(--color-text-on-color); transform: translateY(-3px); }

.brand-foot {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-strong);
  font-size: var(--text-aux);
  color: var(--color-text-disabled);
}
.foot-item { display: inline-flex; align-items: center; }
/* 在线状态用绿点表达，比 [x] 更符合「可用」的直觉。 */
.foot-dot::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--color-success); margin-right: var(--space-2); display: inline-block; }

/* ===== 表单区 ===== */
.login-form { display: flex; align-items: center; justify-content: center; padding: var(--space-7) var(--space-6); }
.form-inner { width: 100%; max-width: 400px; }
.login-form h2 { margin: 0 0 var(--space-2); font-size: var(--text-display-sm); font-weight: 700; line-height: var(--lh-tight); color: var(--color-text-primary); }
.form-hint { margin: 0 0 var(--space-6); font-size: var(--text-aux); color: var(--color-text-tertiary); }
.form-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0 0 var(--space-5);
  padding: var(--space-3);
  border: 1px solid var(--color-danger);
  border-left-width: 3px;
  background: var(--color-red-10);
  color: var(--color-danger-text);
  font-size: var(--text-aux);
}
.form-error-icon { flex: none; padding-top: 4px; }
.login-form :deep(.ant-form-item) { margin-bottom: var(--space-5); }
.login-form :deep(.ant-form-item-label > label) { font-size: var(--text-aux); color: var(--color-text-secondary); }
.login-form :deep(.ant-input-lg), .login-form :deep(.ant-input-affix-wrapper-lg) { min-height: 44px; }
.login-form :deep(.ant-input-affix-wrapper-lg > .ant-input) { min-height: 0; }
.login-submit { height: 44px; letter-spacing: 0.08em; }
.form-submit { margin-top: var(--space-6); margin-bottom: var(--space-3) !important; }
.form-foot { margin: 0; font-size: var(--text-aux); line-height: var(--lh-base); color: var(--color-text-tertiary); }

@media (max-width: 900px) {
  .login-page { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
  .login-brand {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-right: 0;
  }
  .brand-body { display: none; }
  .brand-foot { border: 0; padding: 0; }
  .login-form { padding: var(--space-7) var(--space-5); align-items: flex-start; }
  .login-form h2 { font-size: var(--text-title); }
}
@media (max-width: 560px) {
  .brand-foot { display: none; }
  .brand-text span { font-size: 12px; }
  .login-brand { padding: var(--space-3) var(--space-4); }
  .login-form { padding: var(--space-6) var(--space-4); }
}
</style>
