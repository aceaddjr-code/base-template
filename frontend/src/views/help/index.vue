<template>
  <Page title="帮助中心" description="按页面关联的使用说明、常见问题与系统更新记录。">
    <template #extra><router-link :to="returnPath">{{ returnPath === '/home' ? '返回首页' : '返回原页面' }}</router-link></template>
    <div class="help-page">
      <div v-if="pageHelp" class="from-banner" role="status">
        当前页面：<strong>{{ pageHelp.heading }}</strong>
        <a-button type="link" size="small" @click="locate(pageHelp.sectionId, pageHelp.heading)">查看相关说明</a-button>
      </div>
      <nav class="section-nav" aria-label="帮助目录">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          class="nav-item"
          @click="locate(section.id)"
        >{{ section.title }}</button>
      </nav>
      <section
        v-for="section in sections"
        :key="section.id"
        class="help-section"
        :data-section="section.id"
        :aria-labelledby="`help-${section.id}`"
      >
        <h2 :id="`help-${section.id}`" class="section-title">{{ section.title }}</h2>
        <!-- 内容为代码库内置 Markdown，渲染器整体转义后再按白名单输出 -->
        <div class="section-body" v-html="rendered[section.id]"></div>
      </section>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Page from '@/components/Page.vue'
import { renderMarkdown } from '@/utils/mini-markdown'
import { HELP_SECTIONS, pageHelpFor } from '@/content/help'

const route = useRoute()
const returnPath = computed(() => {
  const from = route.query.from
  return typeof from === 'string' && /^\/(?!\/)/.test(from) ? from : '/home'
})
const sections = HELP_SECTIONS
const rendered = Object.fromEntries(sections.map((section) => [section.id, renderMarkdown(section.markdown)]))

const pageHelp = computed(() => pageHelpFor(String(route.query.from || '')))

/** 定位到小节；给出标题时进一步定位到小节内的对应标题并高亮 */
async function locate(sectionId: string, heading?: string) {
  await nextTick()
  const container = document.querySelector(`[data-section="${sectionId}"]`)
  if (!container) return
  let target: Element | null = container
  if (heading) {
    const headings = Array.from(container.querySelectorAll('h2, h3'))
    target = headings.find((node) => (node.textContent || '').trim() === heading) || container
  }
  container.querySelectorAll('.is-target').forEach((node) => node.classList.remove('is-target'))
  if (heading) {
    target.classList.add('is-target')
  }
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: heading ? 'center' : 'start' })
  }
}

onMounted(() => {
  if (pageHelp.value) void locate(pageHelp.value.sectionId, pageHelp.value.heading)
})
</script>

<style scoped>
.help-page { display: flex; flex-direction: column; gap: var(--space-4); max-width: 860px; }
.from-banner {
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border: var(--rule); background: var(--color-layer-01);
}
.section-nav { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.nav-item {
  padding: 0 var(--space-3); height: var(--control-h);
  border: var(--rule); background: transparent;
  font-family: inherit; font-size: var(--text-aux); color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.nav-item:hover { background: var(--color-layer-hover); border-color: var(--color-border-strong); color: var(--color-text-primary); }
.help-section { scroll-margin-top: 64px; }
.section-title { font-size: var(--text-heading-lg); line-height: var(--lh-tight); margin: 0 0 var(--space-2); scroll-margin-top: 64px; }
.section-body { line-height: var(--lh-relaxed); }
.section-body :deep(h3) { font-size: var(--text-heading); margin: var(--space-4) 0 var(--space-2); scroll-margin-top: 64px; }
.section-body :deep(ul), .section-body :deep(ol) { padding-left: var(--space-5); margin: var(--space-2) 0; }
.section-body :deep(li) { margin: var(--space-1) 0; }
.section-body :deep(code) {
  font-family: inherit; font-size: 0.92em;
  padding: 1px var(--space-1); background: var(--color-layer-01);
}
.section-body :deep(blockquote) {
  margin: var(--space-2) 0; padding: var(--space-2) var(--space-3);
  border-left: 2px solid var(--color-border-strong); color: var(--color-text-secondary);
}
.section-body :deep(a) { color: inherit; text-decoration: underline; }
/* 定位高亮：不用底色块，用 1px 墨色描边圈出目标，视觉上像被框选。 */
.section-body :deep(.is-target) {
  background: var(--color-layer-01);
  outline: 1px solid var(--color-primary);
  outline-offset: 4px;
}
@media (max-width: 768px) {
  .section-body :deep(ul), .section-body :deep(ol) { padding-left: var(--space-4); }
}
</style>
