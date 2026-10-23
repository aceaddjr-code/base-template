<template>
  <a-dropdown trigger="click" placement="bottomRight">

    <a-button aria-label="列设置" :class="iconOnly ? 'icon-only-btn w-9! h-9! px-0!' : ''">
      <template #icon><setting-outlined class="text-base!" /></template>
      <template v-if="!iconOnly">列设置</template>
    </a-button>
    <template #overlay>
      <ColumnPanel
        :preferences="preferences"
        :widths="widths"
      />
    </template>
  </a-dropdown>
</template>

<script setup lang="ts">
/**
 * 列设置（通用列管理组件，兼容壳）
 * 触发器 + 下拉面板，列偏好由 useColumnConfig 持有。
 * 用法：<ColumnSettings v-model:columns="columns" :all-columns="allColumns" storage-key="starter-cols-orders-main" />
 */
import { watch } from 'vue'
import { SettingOutlined } from '@ant-design/icons-vue'
import ColumnPanel from './ColumnPanel.vue'
import { useColumnConfig } from '@/composables/useColumnConfig'

const props = defineProps<{
  /** 列定义数组（v-model），列对象需含 key 或 dataIndex 与 title */
  columns: any[]
  /** 稳定列全集（含隐藏列），不接收可见结果的回写 */
  allColumns?: any[]
  /** localStorage 存储 key，规范：starter-cols-<模块>-<页面> */
  storageKey: string
  /** 列宽的非拖拽入口（F35）：来自页面的 useResizableColumns；不传则面板不含宽度编辑 */
  widths?: { values: Record<string, number>; apply: (key: string, width: number) => void }
  /** 不可隐藏、强制排尾的列 key（默认操作列 'action'） */
  lockedKeys?: string[]

  iconOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:columns', cols: any[]): void
}>()

// 兼容旧调用：首次完整输入仅快照数组，列对象继续共享以保留拖拽宽度。
const initialColumns = [...props.columns]
const preferences = useColumnConfig(props.storageKey, () => props.allColumns ?? initialColumns, () => props.lockedKeys ?? ['action'])
watch(preferences.visibleColumns, columns => emit('update:columns', columns), { immediate: true })
</script>

<style scoped>

.icon-only-btn :deep(.anticon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 1em;
  line-height: 1;
}
</style>
