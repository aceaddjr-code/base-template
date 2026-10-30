<template>
  <section class="list-filters" aria-label="列表筛选">
    <div class="filter-common">
      <slot />
      <div class="filter-actions">
        <a-button type="primary" @click="emit('apply')">查询</a-button>
        <a-button @click="emit('reset')">重置</a-button>
        <a-button v-if="$slots.more" type="link" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起条件' : '更多条件' }}</a-button>
        <slot name="views" />
      </div>
    </div>
    <div v-if="$slots.more" v-show="expanded" class="filter-more"><slot name="more" /></div>
    <!-- 只在真正有信息时占一行：筛选标签、未查询的输入。命中总数由页脚「共 X 条」承担，
         这里不再重复——重复既费一行高度，也和当前页行数对不上容易误读。 -->
    <div v-if="tags.length || dirty" class="filter-summary" aria-live="polite">
      <a-tag v-for="tag in tags" :key="tag.key">{{ tag.label }}<button type="button" class="filter-remove" :aria-label="`移除${tag.label}`" @click="remove(tag.key)">×</button></a-tag>
      <span v-if="dirty" class="filter-dirty">有未查询的输入</span>
    </div>
    <a-alert v-if="failed" type="error" show-icon message="列表加载失败，请重试">
      <template #action><a-button size="small" @click="emit('retry')">重试</a-button></template>
    </a-alert>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { Modal } from 'ant-design-vue'
// total / loading 已移除：命中数由页脚统一展示，这里不再重复一份。
const props = defineProps<{ tags: { key: string; label: string }[]; dirty: boolean; failed: boolean }>()
const emit = defineEmits<{ apply: []; reset: []; remove: [key: string]; retry: [] }>()
const expanded = ref(false)
function remove(key: string) {
  if (!props.dirty) { emit('remove', key); return }
  Modal.confirm({ title: '放弃未查询的输入？', content: '移除已选条件后将重新查询，尚未应用的输入会被替换。', okText: '继续移除', cancelText: '保留输入', onOk: () => emit('remove', key) })
}
</script>
<style scoped>
.list-filters { flex-shrink: 0; padding: 0 0 var(--space-2); }
.filter-common, .filter-more, .filter-actions, .filter-summary { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.filter-more { margin-top: var(--space-3); padding-top: var(--space-3); border-top: var(--rule); }
.filter-summary { margin-top: var(--space-2); color: var(--color-text-tertiary); font-size: var(--text-aux); }
.filter-summary :deep(.ant-tag) { white-space: normal; overflow-wrap: anywhere; margin: 0; }
.filter-dirty { color: var(--color-text-secondary); }
/* 标签里的小 ×：视觉保持 16px，用伪元素把可点区域撑到 28px，
   避免手指点不中而误删不了筛选条件。 */
.filter-remove { position: relative; border: 0; background: transparent; color: inherit; padding: 0 var(--space-1); cursor: pointer; font-size: inherit; }
.filter-remove::after { content: ''; position: absolute; inset: -8px -6px; }
.filter-remove:focus-visible { outline: 2px solid var(--color-primary); }
.list-filters :deep(.filter-field) { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-aux); }
@media(max-width:640px) {
  .list-filters { max-height: 42dvh; overflow-y: auto; overflow-x: hidden; }
  .list-filters :deep(.filter-field) { width: 100%; flex-wrap: wrap; }
  .list-filters :deep(.filter-field > .ant-input-affix-wrapper), .list-filters :deep(.filter-field > .ant-select), .list-filters :deep(.filter-field > .ant-picker) { width: 100% !important; }
}
</style>
