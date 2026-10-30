<template>
  <button type="button" class="announcement-row" @click="emit('open')">
    <span class="row-title">{{ title }}</span>
    <span class="row-time">{{ time }}</span>
  </button>
</template>

<script setup lang="ts">
/**
 * 公告行 —— 首页「最新公告」与历史公告页共用。
 * 之前两处各写一份，已经漂移出 10px / 12px 两种行内边距，同一个列表在两个页面行高不同。
 */
defineProps<{
  title: string
  time: string
}>()

const emit = defineEmits<{ open: [] }>()
</script>

<style scoped>
.announcement-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-2) var(--space-2);
  border: 0;
  border-bottom: var(--rule);
  background: transparent;
  font-family: inherit;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.announcement-row:last-child { border-bottom: 0; }
.announcement-row:hover { background: var(--color-layer-01); }
.row-title { font-size: var(--text-body); overflow-wrap: anywhere; }
.row-time {
  flex: none;
  font-size: var(--text-aux);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
