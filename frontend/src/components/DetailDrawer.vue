<template>
  <a-drawer
    root-class-name="detail-drawer"
    :open="open"
    :title="title"
    placement="right"
    :width="fullscreen ? '100%' : `min(${width}px, 100vw)`"
    :body-style="{ background: 'var(--color-surface)' }"
    :mask-closable="!saving"
    :keyboard="!saving"
    :closable="!saving"
    @close="requestClose"
  >

    <template #extra>
      <template v-if="customExtra">
        <slot name="extra" />
      </template>

      <template v-else-if="editable && saveHandler">
        <template v-if="!editing">
          <a-button v-if="printable" :disabled="loading || !record" @click="printDetail"><PrinterOutlined /> 打印</a-button>
          <a-button v-access="saveAccess" :disabled="loading || !record" @click="startEdit"><EditOutlined /> 编辑</a-button>
        </template>
        <template v-else>
          <a-tag color="processing">编辑中</a-tag>
          <a-button class="mr-2" :disabled="saving" @click="cancelEdit">取消</a-button>
          <a-button type="primary" :loading="saving" @click="saveEdit">保存</a-button>
        </template>
      </template>

      <a-tooltip :title="fullscreen ? '退出全屏' : '全屏查看'">
        <a-button type="text" class="ml-2" @click="fullscreen = !fullscreen">
          <FullscreenExitOutlined v-if="fullscreen" />
          <FullscreenOutlined v-else />
        </a-button>
      </a-tooltip>
    </template>
    <a-spin :spinning="loading">
      <div :ref="bindRoot" class="flex flex-col gap-1">
        <FormFeedback :items="feedbackItems" :request-id="feedbackRequestId" @focus="feedback.focus" />
        <!-- 大卡片：卡片式详情（字段按 group 分组展示） -->
        <a-card :bordered="false" :body-style="{ padding: '10px' }">
          <slot name="before" />
          <template v-if="record && visibleFields.length">
            <template v-for="(g, gi) in fieldGroups" :key="gi">
              <div v-if="g.title" class="detail-group-title">{{ g.title }}</div>
              <a-descriptions :column="{ xs: 1, sm: 2, md: column }" size="small" bordered>
                <a-descriptions-item
                  v-for="f in g.fields"
                  :key="f.dataIndex"
                  :label="f.label"
                  :span="f.span ?? 1"
                >
                  <template v-if="editing && editableFields.has(f.dataIndex)">
                    <div :data-form-field="f.dataIndex">
                    <a-input v-if="(editableFields.get(f.dataIndex)?.inputType ?? 'input') === 'input'" v-model:value="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :maxlength="editableFields.get(f.dataIndex)?.maxLength" :disabled="saving" />
                    <a-textarea v-else-if="editableFields.get(f.dataIndex)?.inputType === 'textarea'" v-model:value="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :maxlength="editableFields.get(f.dataIndex)?.maxLength" :disabled="saving" :rows="4" show-count />
                    <a-input-number v-else-if="editableFields.get(f.dataIndex)?.inputType === 'number'" v-model:value="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :disabled="saving" style="width: 100%" />
                    <a-date-picker v-else-if="editableFields.get(f.dataIndex)?.inputType === 'date'" v-model:value="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :disabled="saving" value-format="YYYY-MM-DD" style="width: 100%" />
                    <a-select v-else-if="editableFields.get(f.dataIndex)?.inputType === 'select'" v-model:value="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :options="editableFields.get(f.dataIndex)?.options" :allow-clear="!editableFields.get(f.dataIndex)?.required" :disabled="saving" style="width: 100%" />
                    <a-switch v-else v-model:checked="editForm[f.dataIndex]" :aria-label="f.label" v-bind="feedback.attrs(f.dataIndex)" :disabled="saving" />
                    <p v-if="fieldErrors[f.dataIndex]" :id="feedback.errorId(f.dataIndex)" class="field-error">{{ fieldErrors[f.dataIndex] }}</p>
                    </div>
                  </template>
                  <template v-else-if="f.valueType === 'tag' && record[f.dataIndex]">
                    <a-tag :color="f.tagColor?.(record[f.dataIndex]) ?? 'default'">
                      {{ f.formatter ? f.formatter(record) : record[f.dataIndex] }}
                    </a-tag>
                  </template>
                  <template v-else-if="f.valueType === 'boolean'">
                    <span :class="{ 'cell-dash': record[f.dataIndex] == null }">{{ record[f.dataIndex] == null ? '-' : (record[f.dataIndex] ? '是' : '否') }}</span>
                  </template>
                  <template v-else-if="f.formatter">
                    {{ f.formatter(record) }}
                  </template>
                  <template v-else>
                    <span class="detail-text" :class="{ 'cell-dash': isEmptyValue(record[f.dataIndex]) }">{{ formatDate(record[f.dataIndex]) }}</span>
                  </template>
                </a-descriptions-item>

                <template v-if="gi === fieldGroups.length - 1">
                  <a-descriptions-item v-if="hasCreatedAt" label="创建时间">
                    {{ formatDateTime(record.createdAt) }}
                  </a-descriptions-item>
                  <a-descriptions-item v-if="hasUpdatedAt" label="修改时间">
                    {{ formatDateTime(record.updatedAt) }}
                  </a-descriptions-item>
                </template>
              </a-descriptions>
            </template>
          </template>
          <a-empty v-else-if="open && !loading && !$slots.default" :description="record ? '暂无数据' : '详情加载失败或记录不可见'" />
          <slot />
        </a-card>
      </div>
    </a-spin>
  </a-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { formatDate, formatDateTime, isEmptyValue } from '@/utils/format'
import { EditOutlined, FullscreenOutlined, FullscreenExitOutlined, PrinterOutlined } from '@ant-design/icons-vue'
import { buildPrintDocument, collectPrintRows, printHtml } from '@/utils/print-document'
import FormFeedback from './FormFeedback.vue'
import { useFormModal } from '@/composables/useFormModal'

export interface DetailField {
  /** 展示标签 */
  label: string
  /** 记录字段名 */
  dataIndex: string
  /** a-descriptions-item 的 span（长文本用 2） */
  span?: number
  /** 值类型：tag 渲染为带色标签、boolean 渲染为 是/否 */
  valueType?: 'text' | 'tag' | 'boolean'
  /** valueType='tag' 时根据值返回标签颜色 */
  tagColor?: (value: any) => string
  /** 复合值自定义渲染（如 "12 台"、起止日期）；缺省走 formatDate */
  formatter?: (record: Record<string, any>) => string
  /** 是否允许详情内编辑（editable 开启且未传 editFields 时，仅该标记字段进入编辑表单） */
  editable?: boolean
  /** editable 时编辑控件类型（缺省 input） */
  inputType?: 'input' | 'textarea' | 'number' | 'date' | 'select' | 'switch'
  /** inputType='select' 时下拉选项 */
  options?: { label: string; value: string | number }[]
  /** editable 时必填（保存时校验） */
  required?: boolean
  maxLength?: number

  hidden?: (record: Record<string, any> | null | undefined) => boolean

  group?: string
}

/** 详情内编辑字段配置（editable/editFields 开启编辑模式时生效） */
export interface DetailEditField {
  /** 展示标签 */
  label: string
  /** 记录字段名 */
  dataIndex: string
  /** a-form-item 的 span（长文本用 2） */
  span?: number
  /** 编辑控件类型（缺省 input） */
  inputType?: 'input' | 'textarea' | 'number' | 'date' | 'select' | 'switch'
  /** inputType='select' 时下拉选项 */
  options?: { label: string; value: string | number }[]
  /** 必填（保存时校验，为空提示） */
  required?: boolean
  maxLength?: number
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    record: Record<string, any> | null | undefined
    fields: DetailField[]
    loading?: boolean

    showAuditTime?: boolean
    column?: number
    /** 抽屉宽度（默认 1000） */
    width?: number
    /** 是否启用详情内编辑（需同时传入 saveHandler；true 时抽屉右上角出现「编辑」按钮） */
    editable?: boolean

    saveAccess?: string[]
    /** 可编辑字段配置；缺省时使用 fields 中标记 editable 的字段（自动推断控件类型） */
    editFields?: DetailEditField[]
    /** 保存处理器：接收编辑后的字段值，负责调更新 API；resolve 表示成功（退出编辑模式并提示），reject/throw 表示失败（保持编辑模式） */
    saveHandler?: (payload: Record<string, any>) => Promise<void>
    /** 取消时重载服务端详情；不修改草稿以外的数据。 */
    reloadHandler?: () => Promise<void>

    customExtra?: boolean
    /** 是否提供打印入口（F21）：查看态显示「打印」，范围为当前已加载的这条记录 */
    printable?: boolean
    /** 打印抬头系统名称（F21）；不传则打印文档不含系统名 */
    systemName?: string
  }>(),
  { title: '单据详情', loading: false, column: 3, width: 1000, editable: false, editFields: undefined, saveHandler: undefined, customExtra: false, showAuditTime: true, printable: false, systemName: undefined },
)

const hasCreatedAt = computed(
  () =>
    props.showAuditTime &&
    !!props.record?.createdAt &&
    !props.fields.some((f) => f.dataIndex === 'createdAt'),
)
const hasUpdatedAt = computed(
  () =>
    props.showAuditTime &&
    !!props.record?.updatedAt &&
    !props.fields.some((f) => f.dataIndex === 'updatedAt'),
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 详情内编辑保存成功后触发（父页面用于刷新详情/列表数据） */
  (e: 'saved'): void
}>()

// ===== 详情内编辑（editable + saveHandler 开启）：状态机走共享 useFormModal，visible 即编辑中 =====
const fullscreen = ref(false)

/** 可编辑字段：优先 editFields；缺省取 fields 中标记 editable 的字段 */

const visibleFields = computed(() => (props.fields ?? []).filter((f) => !f.hidden?.(props.record)))

const fieldGroups = computed(() => {
  const groups: { title: string; fields: DetailField[] }[] = []
  for (const f of visibleFields.value) {
    const title = f.group ?? ''
    let g = groups.find((x) => x.title === title)
    if (!g) {
      g = { title, fields: [] }
      groups.push(g)
    }
    g.fields.push(f)
  }
  return groups
})

const editFieldList = computed<DetailEditField[]>(() => {
  if (props.editFields?.length) return props.editFields
  return visibleFields.value
    .filter((f) => f.editable)
    .map((f) => ({ label: f.label, dataIndex: f.dataIndex, span: f.span, inputType: f.inputType, options: f.options, required: f.required, maxLength: f.maxLength }))
})
const editableFields = computed(() => new Map(editFieldList.value.map(field => [field.dataIndex, field])))

/** 详情切换令牌：保存期间记录被切换时，旧记录的结果不再打扰当前视图 */
let editContext = 0

const editSession = useFormModal<Record<string, any>, number | string>({
  fields: () => Object.fromEntries(editFieldList.value.map(field => [field.dataIndex, field.label])),
  defaults: () => ({}),
  validate: form => {
    const errors: Record<string, string> = {}
    for (const f of editFieldList.value) {
      const v = form[f.dataIndex]
      if (f.required && (v == null || (typeof v === 'string' && !v.trim()))) {
        errors[f.dataIndex] = `请填写${f.label}`
      }
      if (typeof v === 'string' && f.maxLength && Array.from(v).length > f.maxLength) errors[f.dataIndex] = `${f.label}不能超过 ${f.maxLength} 字`
    }
    return errors
  },
  save: async form => {
    if (!props.saveHandler) return
    const context = editContext
    // 空值统一转 null（与弹窗表单一致），其余原样提交
    const payload: Record<string, any> = {}
    for (const f of editFieldList.value) {
      const v = form[f.dataIndex]
      payload[f.dataIndex] = v === '' || v == null ? null : v
    }
    try {
      await props.saveHandler(payload)
      if (context !== editContext || !props.open) return
      message.success('已保存')
      emit('saved')
    } catch (error) {
      // 详情已切换到别的记录：旧记录的保存结果不再打扰当前视图
      if (context === editContext && props.open) throw error
    }
  },
  active: () => props.open,
  snapshot: form => Object.fromEntries(editFieldList.value.map(field => [field.dataIndex, form[field.dataIndex] === '' || form[field.dataIndex] == null ? null : form[field.dataIndex]])),
})
const editing = editSession.visible
const saving = editSession.loading
const editForm = editSession.form
const feedback = editSession.feedback
const bindRoot = editSession.bindRoot
const { errors: fieldErrors, summary: feedbackItems, requestId: feedbackRequestId } = feedback

function requestClose() { editSession.guard(() => emit('update:open', false)) }

function resetEditState() {
  editSession.visible.value = false
  feedback.clear()
  for (const key of Object.keys(editForm)) delete editForm[key]
}

watch(
  [() => props.open, () => props.record?.id],
  () => {
    editContext++
    resetEditState()
  },
)

function startEdit() {
  if (!props.open || !props.record || props.loading || saving.value || !props.editable || !props.saveHandler) return
  editSession.open(props.record.id ?? null, Object.fromEntries(editFieldList.value.map((f) => {
    const value = props.record![f.dataIndex]
    return [f.dataIndex, Array.isArray(value) ? [...value] : value ?? null]
  })))
}

async function cancelEdit() {
  editSession.guard(async () => {
    resetEditState()
    try { await props.reloadHandler?.() } catch { /* 当前查看态保留最近服务端数据 */ }
  })
}

/** F06 冲突恢复：调用方已明确确认“放弃当前修改并载入最新内容”后直接退出编辑态，不经未保存确认 */
function exitEditToView() { resetEditState() }

// ===== 打印（F21）：范围为当前查看的这条记录，字段与查看态同口径 =====
function printDetail() {
  if (!props.record) return
  const rows = collectPrintRows(visibleFields.value, props.record, { showAuditTime: props.showAuditTime })
  const html = buildPrintDocument({
    title: props.title,
    systemName: props.systemName,
    recordId: props.record.id ?? null,
    rows,
    printedAt: new Date(),
    scopeNote: '打印范围：当前查看的单据详情。',
  })
  printHtml(html)
}

function saveEdit() {
  if (props.loading) return
  void editSession.submit()
}

defineExpose({ startEdit, exitEditToView })
</script>

<style scoped>
.detail-text { white-space: pre-wrap; overflow-wrap: anywhere; }

/* 字段网格：标签列压成浅底窄列，值列留给内容，长文本按容器换行。 */
:deep(.ant-descriptions-item-label) {
  color: var(--color-text-secondary);
  font-size: var(--text-aux);
  font-weight: 400;
  line-height: 1.5;
  white-space: nowrap;
  padding: 6px 12px !important;
}
:deep(.ant-descriptions-item-content) {
  color: var(--color-text-primary);
  font-size: var(--text-aux);
  line-height: 1.6;
  padding: 6px 12px !important;
  word-break: break-word;
}
/* 标签列按内容收窄，把宽度让给值列。 */
:deep(.ant-descriptions-item-label) { width: 1%; }
:deep(.ant-descriptions-item-content .ant-input),
:deep(.ant-descriptions-item-content .ant-select),
:deep(.ant-descriptions-item-content .ant-picker) { width: 100%; }
</style>

<style>
/* 抽屉头：标题与操作同一行对齐，细线分隔内容区。 */
.detail-drawer .ant-drawer-header { padding: var(--space-3) var(--space-4); border-bottom: var(--rule); }
.detail-drawer .ant-drawer-title { font-size: var(--text-heading); font-weight: 700; }
.detail-drawer .ant-descriptions-item-label { background: var(--color-layer-01) !important; }

/* Drawer 通过 Teleport 挂载；用专属根类约束样式，保证窄屏标题和操作分别成行。 */
@media (max-width: 600px) {
  .detail-drawer .ant-drawer-header { flex-wrap: wrap; gap: 8px; }
  .detail-drawer .ant-drawer-header-title { min-width: 0; flex-basis: 100%; }
  .detail-drawer .ant-drawer-extra { width: 100%; margin-inline-start: 0; display: flex; justify-content: flex-end; flex-wrap: wrap; align-items: center; }
}
.detail-group-title {
  font-size: var(--text-aux);
  font-weight: 700;
  color: var(--color-text-primary);
  margin: var(--space-4) 0 var(--space-2);
  padding-bottom: var(--space-1);
  border-bottom: var(--rule);
  display: flex;
  align-items: center;
}
/* 首个分组不需要再空出上边距。 */
.detail-group-title:first-child { margin-top: 0; }
</style>
