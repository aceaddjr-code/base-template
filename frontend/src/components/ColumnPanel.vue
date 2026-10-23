<template>
  <div class="cs-panel">
    <div class="cs-head">
      <a-checkbox :checked="allChecked" :indeterminate="indeterminate" @change="toggleAll">
        全选
      </a-checkbox>
      <a-button type="link" size="small" @click="handleReset">恢复默认</a-button>
    </div>
    <div class="cs-body">
      <div
        v-for="(field, index) in fields"
        :key="field.key"
        class="cs-item"
        :class="{ 'is-locked': isLocked(field.key), 'is-dragging': dragIndex === index }"
        :draggable="!isLocked(field.key)"
        @dragstart="onDragStart(index)"
        @dragover.prevent="onDragOver(index)"
        @dragend="onDragEnd"
      >
        <holder-outlined v-if="!isLocked(field.key)" class="cs-handle" />
        <span v-else class="cs-handle cs-handle-locked" />
        <a-checkbox
          :checked="field.visible"
          :disabled="isLocked(field.key)"
          @change="onToggle(field.key)"
        >
          {{ field.label }}
        </a-checkbox>
        <span v-if="!isLocked(field.key)" class="cs-order">
          <a-tooltip title="上移">
            <a-button type="text" size="small" class="cs-order-btn" :disabled="index === 0 || isLocked(fields[index - 1]!.key)" :aria-label="`上移${field.label}`" @click="move(index, -1)">
              <arrow-up-outlined />
            </a-button>
          </a-tooltip>
          <a-tooltip title="下移">
            <a-button type="text" size="small" class="cs-order-btn" :disabled="index === fields.length - 1 || isLocked(fields[index + 1]!.key)" :aria-label="`下移${field.label}`" @click="move(index, 1)">
              <arrow-down-outlined />
            </a-button>
          </a-tooltip>
        </span>
        <a-input-number
          v-if="widths && widths.values[field.key] != null"
          class="cs-width"
          size="small"
          :min="60"
          :max="1000"
          :value="widths.values[field.key]"
          :disabled="disabled"
          :aria-label="`${field.label}列宽`"
          @change="(value: any) => widths!.apply(field.key, Number(value))"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { HolderOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons-vue'
import type { ColumnPreferences } from '@/composables/useColumnConfig'

const props = defineProps<{
  preferences: ColumnPreferences
  /** 列宽的非拖拽入口（F35）：传入后可见列显示宽度编辑框；不传保持原状 */
  widths?: { values: Record<string, number>; apply: (key: string, width: number) => void }
  disabled?: boolean
}>()
const { fields, isLocked, allChecked, indeterminate } = props.preferences

function onToggle(key: string): void {
  props.preferences.toggleField(key)
}
function toggleAll(event: { target: { checked: boolean } }): void {
  props.preferences.toggleAll(event.target.checked)
}
/** 非拖拽排序入口：上移/下移一列，越界或跨锁定列时止步 */
function move(index: number, offset: -1 | 1): void {
  const target = index + offset
  if (target < 0 || target >= fields.value.length || isLocked(fields.value[target]!.key)) return
  props.preferences.moveFieldTo(index, target)
}
const dragIndex = ref<number | null>(null)
function onDragStart(index: number): void {
  if (!isLocked(fields.value[index].key)) dragIndex.value = index
}
function onDragOver(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index || isLocked(fields.value[index].key)) return
  props.preferences.moveFieldTo(dragIndex.value, index)
  dragIndex.value = index
}
function onDragEnd(): void { dragIndex.value = null }
function handleReset(): void { props.preferences.resetFields() }
</script>

<style scoped>
.cs-panel {
  width: 240px;
  background: #fdfcfc;
  border-radius: 0;
  border: 1px solid var(--color-border-subtle);
  padding: 8px;
}
.cs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid #f8f7f7;
  margin-bottom: 4px;
}
.cs-body {
  max-height: 320px;
  overflow-y: auto;
}
.cs-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
}
.cs-item:hover {
  background: #f8f7f7;
}
.cs-item.is-dragging {
  opacity: 0.6;
  background: var(--color-layer-hover);
}
.cs-item.is-locked {
  cursor: not-allowed;
  opacity: 0.75;
}
.cs-handle {
  font-size: 14px;
  color: #646262;
  cursor: grab;
  flex-shrink: 0;
}
.cs-handle-locked {
  display: inline-block;
  width: 12px;
}
.cs-order {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.cs-order-btn {
  width: 20px;
  height: 20px;
  padding: 0;
}
.cs-width {
  width: 60px;
  flex-shrink: 0;
  margin-left: 4px;
}
</style>
