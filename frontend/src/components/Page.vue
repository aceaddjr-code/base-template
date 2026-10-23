<template>
  <div class="starter-page" :class="{ 'has-footer': !!$slots.footer }">

    <div v-if="title || description || $slots.header || $slots.extra" class="starter-page-header page-head-rule">
      <div class="starter-page-header-main">
        <slot name="header">
          <h2 v-if="title" class="starter-page-title">{{ title }}</h2>
          <p v-if="description" class="starter-page-desc">{{ description }}</p>
        </slot>
      </div>
      <div class="starter-page-header-extra">
        <div class="starter-page-today">今日 {{ todayStr }}</div>
        <slot name="extra" />
      </div>
    </div>
    <div class="starter-page-content">
      <slot />
    </div>

    <slot name="footer" />
  </div>
</template>

<script lang="ts" setup>
/**
 * Page 组件 - 替代 @vben/common-ui 的 Page
 * 提供标题、描述和内容区域的简单包装
 */
defineProps<{
  title?: string;
  description?: string;
}>();

const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
</script>

<style scoped>
.starter-page {
  padding: var(--page-pad);
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* 有页脚插槽时去掉底部内边距：页脚直接贴住内容区底部，表格多出 24px 可用高度。 */
.starter-page.has-footer { padding-bottom: 0; }
.starter-page-header {
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: var(--rule);
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--space-4);
  flex-shrink: 0;
}
.starter-page-header-main {
  flex: 1;
  min-width: 0;
}
.starter-page-header-extra {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-tertiary);
  font-size: var(--text-aux);
}
.starter-page-today { font-variant-numeric: tabular-nums; white-space: nowrap; }

/* 页面标题比正文高一级，靠字号与字重拉开层级，不引入第三种颜色。 */
.starter-page-title {
  font-size: var(--text-title);
  font-weight: 700;
  line-height: var(--lh-tight);
  margin: 0;
  color: var(--color-text-primary);
}
.starter-page-desc {
  font-size: var(--text-aux);
  line-height: var(--lh-base);
  color: var(--color-text-tertiary);
  margin: var(--space-1) 0 0;
  max-width: 68ch;
}

.starter-page-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
@media (max-width: 768px) {
  .starter-page { padding: var(--page-pad) var(--page-pad-sm); }
  .starter-page-header { flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); margin-bottom: var(--space-3); }
  .starter-page-header-main { flex-basis: 100%; }
  .starter-page-today { display: none; }
  .starter-page-content { overflow-y: auto; -webkit-overflow-scrolling: touch; }
}
</style>
