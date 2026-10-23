<template>
  <DetailDrawer ref="drawer" :open="open" title="示例事项详情" :record="detail" :fields="fields" :column="2" :loading="loading" editable printable :system-name="appStore.siteName" :save-access="['example-items:update']" :save-handler="save" :reload-handler="reload" @update:open="emit('update:open', $event)" @saved="emit('updated')">
    <template #before>
      <!-- F06 乐观锁冲突：保留草稿，给出“继续编辑 / 载入最新内容”两个明确出口 -->
      <div v-if="conflict" class="conflict-box" role="alert">
        <a-alert type="warning" show-icon message="保存未生效：记录已被他人修改" description="服务端内容已更新，当前修改仍保留。再次保存前建议先载入最新内容。" />
        <div class="conflict-actions">
          <a-button size="small" :disabled="loading" @click="conflict = false">继续编辑</a-button>
          <a-button size="small" type="primary" :disabled="loading" @click="loadLatest">载入最新内容（放弃当前修改）</a-button>
        </div>
      </div>
    </template>
  </DetailDrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DetailDrawer, { type DetailField } from '@/components/DetailDrawer.vue'
import { getExample, updateExample, type ExampleItem } from '@/api/example'
import { statusColor, statusLabel, statusOptions } from './example-options'
import { useDict } from '@/composables/useDict'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ open: boolean; recordId: number | null; startInEdit?: boolean }>()
const emit = defineEmits<{ (event: 'update:open', open: boolean): void; (event: 'updated'): void }>()
const appStore = useAppStore()
const drawer = ref<InstanceType<typeof DetailDrawer>>()
const detail = ref<ExampleItem | null>(null)
const loading = ref(false)
// F06:保存与加载时的服务端版本不一致（409）时置位，提示保留草稿或载入最新
const conflict = ref(false)
let requestVersion = 0
const { options: categoryOptions, labelOfAny: categoryLabelOfAny } = useDict('item_category')

// 类别为字典驱动字段（F40）：编辑候选仅启用项;存量停用值回显"名称（已停用）"
const fields = computed((): DetailField[] => [
  { label: '标题', dataIndex: 'title', editable: true, required: true, maxLength: 100 },
  { label: '状态', dataIndex: 'status', valueType: 'tag', tagColor: statusColor, formatter: (record: Record<string, any>) => statusLabel(String(record.status)), editable: true, required: true, inputType: 'select', options: statusOptions },
  { label: '类别', dataIndex: 'category', editable: true, inputType: 'select', options: categoryOptions.value, formatter: (record: Record<string, any>) => categoryLabelOfAny(record.category as string | null | undefined) },
  { label: '说明', dataIndex: 'description', span: 2, editable: true, inputType: 'textarea', maxLength: 500 },
])

async function reload(enterEdit = false) {
  const id = props.recordId
  if (!props.open || id == null) return
  const version = ++requestVersion
  loading.value = true
  try {
    const record = await getExample(id)
    if (version !== requestVersion || !props.open || props.recordId !== id) return
    detail.value = record
    loading.value = false
    await nextTick()
    if (enterEdit && version === requestVersion && props.open) drawer.value?.startEdit()
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

async function save(payload: Record<string, any>) {
  const id = props.recordId
  const version = requestVersion
  if (!props.open || id == null || !detail.value) throw new Error('请先加载详情')
  // F06:回传加载时的版本，服务端原子条件更新；版本已被推进时返回 409
  try {
    await updateExample(id, { ...payload, version: detail.value.version }, { errorFeedback: 'form' })
  } catch (error) {
    if ((error as { response?: { status?: number } }).response?.status === 409) conflict.value = true
    throw error
  }
  conflict.value = false
  // 先取得完整服务端值再替换详情，刷新失败时仍保留当前编辑草稿。
  let record: ExampleItem
  try { record = await getExample(id, { errorFeedback: 'form' }) }
  catch (error) {
    const failure = error as { response?: unknown; requestId?: string }
    throw Object.assign(new Error('详情回读失败'), { response: failure?.response, requestId: failure?.requestId,
      feedbackMessage: '保存已提交，但详情回读失败。请取消编辑后核对服务端结果，当前输入已保留。' })
  }
  if (version !== requestVersion || !props.open || props.recordId !== id) throw new Error('当前详情已切换')
  detail.value = record
}

/** 冲突后载入最新内容：明确放弃当前草稿（按钮文案已声明后果），退出编辑态并重读服务端 */
async function loadLatest() {
  conflict.value = false
  drawer.value?.exitEditToView()
  await reload()
}

watch([() => props.open, () => props.recordId], () => {
  requestVersion++
  detail.value = null
  conflict.value = false
  if (props.open && props.recordId != null) void reload(props.startInEdit).catch(() => { /* 请求层已反馈，抽屉显示不可用状态 */ })
  else loading.value = false
}, { immediate: true })
onBeforeUnmount(() => { requestVersion++ })
</script>

<style scoped>
/* F06 冲突提示：放在字段区之前，操作按钮随提示成组，窄屏换行。 */
.conflict-box { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-2); }
.conflict-actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
