<script setup lang="ts">

import StickyScrollBar from './StickyScrollBar.vue'

const props = withDefaults(defineProps<{
  /** 横滚条来源（useListPage 的 stickySource） */
  source: () => HTMLElement | null
  /** 分页状态（useListPage 的 pagination） */
  pagination: { current: number; pageSize: number; total: number }
  /** 分页总数文案（默认 `共 X 条`；个别页面单位不同可覆盖，如 `共 X 份`） */
  totalText?: (t: number) => string
}>(), {
  totalText: (t: number) => `共 ${t} 条`,
})

const emit = defineEmits<{
  (e: 'change', page: number, pageSize: number): void
  (e: 'size-change', current: number, size: number): void
}>()
</script>

<template>
  <div class="list-footer shrink-0">
    <StickyScrollBar :source="source" />
    <div class="list-pagination">
      <a-pagination
        :current="pagination.current"
        :page-size="pagination.pageSize"
        :total="pagination.total"
        :show-size-changer="true"
        :show-total="props.totalText"
        size="small"
        @change="(page: number, pageSize: number) => emit('change', page, pageSize)"
        @show-size-change="(current: number, size: number) => emit('size-change', current, size)"
      />
    </div>
  </div>
</template>

<style scoped>
.list-footer { background: var(--color-surface); border-top: var(--rule); flex-shrink: 0; }
.list-pagination { display: flex; justify-content: flex-end; padding: 0; min-width: 0; }
.list-pagination :deep(.ant-pagination-options-size-changer .ant-select-selection-item) { font-size: 12px; }
@media (max-width: 640px) {
  .list-pagination { overflow-x: auto; justify-content: flex-start; }
  .list-pagination :deep(.ant-pagination-total-text) { display: none; }
}
</style>
