<template>
  <main class="notfound">
    <!-- 与全站同一套标记语言：方括号编号、发丝线、墨条，不用插画也不用居中堆叠。 -->
    <div class="nf-inner">
      <p class="nf-code">[ 404 ]</p>
      <h1 class="nf-title">这里没有页面</h1>
      <p class="nf-desc">地址可能已经失效，或者当前账号没有该模块的菜单权限。</p>
      <div class="nf-actions">
        <a-button type="primary" @click="router.push('/')">返回工作台</a-button>
        <a-button @click="router.push('/help')">打开帮助中心</a-button>
      </div>
      <p class="nf-hint">若确认链接无误，请联系管理员检查角色菜单权限。</p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.notfound {
  display: flex;
  align-items: center;
  min-height: 100dvh;
  padding: var(--page-pad) var(--space-6);
  background: var(--color-bg-page);
}
/* 靠左对齐 + 一条 2px 墨条：和表格选中行、未读通知同一套「定位」手法。 */
.nf-inner {
  max-width: 520px;
  padding-left: var(--space-5);
  border-left: 2px solid var(--color-primary);
}
.nf-code {
  margin: 0 0 var(--space-3);
  font-size: var(--text-aux);
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.nf-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-display-sm);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--color-text-primary);
}
.nf-desc {
  margin: 0 0 var(--space-5);
  max-width: 46ch;
  font-size: var(--text-body);
  line-height: var(--lh-relaxed);
  color: var(--color-text-secondary);
}
.nf-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.nf-hint {
  margin: var(--space-5) 0 0;
  padding-top: var(--space-3);
  border-top: var(--rule);
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
}

@media (max-width: 640px) {
  .notfound { padding: var(--page-pad) var(--page-pad-sm); }
  .nf-inner { padding-left: var(--space-4); }
  .nf-title { font-size: var(--text-title); }
}
</style>
