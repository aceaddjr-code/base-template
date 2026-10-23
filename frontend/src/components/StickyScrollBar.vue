<template>
  <div v-show="visible" ref="barEl" class="sticky-h-scroll" @scroll="onBarScroll">
    <div class="sticky-h-scroll-track" :style="{ width: trackWidth + 'px' }" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{ source: () => HTMLElement | null | undefined }>(), {})

const barEl = ref<HTMLElement | null>(null)
const trackWidth = ref(0)
const visible = ref(false)
let syncing = false

/** 从表格滚动容器同步滚动位置、轨道宽度与显隐 */
function syncFromSource() {
  const src = props.source()
  const bar = barEl.value
  if (!src || !bar) return
  syncing = true
  bar.scrollLeft = src.scrollLeft
  // 页脚与表格宽度可能不同，轨道需保证两者的可滚动距离一致。
  trackWidth.value = src.scrollWidth - src.clientWidth + bar.clientWidth
  visible.value = src.scrollWidth > src.clientWidth + 1
  syncing = false
}

/** 拖动滑轨 → 同步表格容器 */
function onBarScroll() {
  const src = props.source()
  const bar = barEl.value
  if (!src || !bar || syncing) return
  syncing = true
  src.scrollLeft = bar.scrollLeft
  syncing = false
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // 轻量轮询：表格宽度/滚动位置变化（分页、列宽、折叠等）自动跟随
  timer = setInterval(() => {
    if (document.hidden) return
    syncFromSource()
  }, 300)
  window.addEventListener('resize', syncFromSource)
  document.addEventListener('visibilitychange', syncFromSource)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('resize', syncFromSource)
  document.removeEventListener('visibilitychange', syncFromSource)
})
</script>

<style scoped>

.sticky-h-scroll {
  width: 100%;
  height: 14px;
  overflow-x: auto;
  background: transparent;
  scrollbar-width: thin;
}
.sticky-h-scroll::-webkit-scrollbar {
  height: 6px;
}
.sticky-h-scroll::-webkit-scrollbar-thumb {
  background: #9a9898;
  border-radius: 3px;
}
.sticky-h-scroll::-webkit-scrollbar-thumb:hover {
  background: #646262;
}
.sticky-h-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.sticky-h-scroll-track {
  height: 1px;
}
</style>
