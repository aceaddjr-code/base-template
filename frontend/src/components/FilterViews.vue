<template>
  <a-popover trigger="click" placement="bottomRight" overlay-class-name="filter-views-popover">
    <a-button type="link" aria-label="常用视图">{{ hasDefault && !appliedEqualsDefault ? `视图：${defaultName}` : '视图' }}</a-button>
    <template #content>
      <div class="filter-views-panel" aria-label="常用筛选视图">
        <p class="panel-note">保存在本浏览器当前账号下；相对日期（如“本月”）按应用当天重算。</p>
        <div v-if="views.length" class="view-list" role="listbox" aria-label="已保存视图">
          <div v-for="view in views" :key="view.id" class="view-row" :class="{ 'is-editing': editingId === view.id }">
            <template v-if="editingId === view.id">
              <a-input v-model:value="editingName" size="small" :maxlength="30" aria-label="视图名称" @press-enter="confirmRename(view.id)" />
              <a-button size="small" type="link" aria-label="确认重命名" @click="confirmRename(view.id)">确定</a-button>
              <a-button size="small" type="link" aria-label="取消重命名" @click="editingId = undefined">取消</a-button>
            </template>
            <template v-else>
              <button type="button" class="view-name" role="option" :aria-selected="view.id === defaultId" @click="applyView(view)">
                <StarFilled v-if="view.id === defaultId" class="star" aria-label="默认视图" />
                <span>{{ view.name }}</span>
              </button>
              <span class="view-actions">
                <a-tooltip :title="view.id === defaultId ? '取消默认' : '设为默认'"><a-button type="text" size="small" :aria-label="view.id === defaultId ? '取消默认视图' : '设为默认视图'" @click="setDefault(view.id)"><StarFilled v-if="view.id === defaultId" /><StarOutlined v-else /></a-button></a-tooltip>
                <a-tooltip title="重命名"><a-button type="text" size="small" aria-label="重命名视图" @click="startRename(view)"><EditOutlined /></a-button></a-tooltip>
                <a-popconfirm title="确定删除该视图？" ok-text="确定" cancel-text="取消" @confirm="removeView(view.id)">
                  <a-button type="text" size="small" danger aria-label="删除视图"><DeleteOutlined /></a-button>
                </a-popconfirm>
              </span>
            </template>
          </div>
        </div>
        <p v-else class="panel-empty">还没有保存的视图</p>
        <div class="panel-save">
          <a-input v-model:value="saveName" size="small" :maxlength="30" placeholder="视图名称" aria-label="新视图名称" @press-enter="saveCurrent" />
          <a-button size="small" :disabled="!saveName.trim() || disabled" @click="saveCurrent">保存当前条件</a-button>
        </div>
      </div>
    </template>
  </a-popover>
</template>

<script setup lang="ts">
/**
 * 个人常用筛选视图入口（F27）：保存/更新（同名覆盖）/重命名/删除/设默认。
 * 保存前把 date-fields 中与预设一致的区间转为相对语义（如“本月”），应用时按当天重算。
 */
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { StarFilled, StarOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { useSavedFilterViews } from '@/composables/useSavedFilterViews'
import { matchDateRangePreset, resolveDateRangePreset } from '@/utils/filter-dates'

export interface FilterViewPayload {
  query: Record<string, unknown>
  sort: Record<string, unknown>
  staleKeys: string[]
  name: string
}

const props = defineProps<{
  moduleKey: string
  applied: Record<string, unknown>
  sort: Record<string, unknown>
  /** 模块登记的筛选字段全集：应用视图时以它判断字段失效（不能依赖当前 applied 的 key，未筛选字段会被 copy 丢掉） */
  knownFields: string[]
  /** 日期区间字段：保存时识别相对语义，应用时按当天重算 */
  dateFields?: string[]
  /** 查询进行中/失败时禁止保存 */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'apply-view': [payload: FilterViewPayload] }>()

const { views, defaultId, save, rename, remove: removeView, setDefault, loadView } = useSavedFilterViews({
  moduleKey: props.moduleKey,
  knownFields: () => props.knownFields,
})

const saveName = ref('')
const editingId = ref<string | undefined>()
const editingName = ref('')

const defaultName = computed(() => views.value.find((view) => view.id === defaultId.value)?.name ?? '')
const hasDefault = computed(() => defaultId.value != null)
const appliedEqualsDefault = computed(() => {
  const view = views.value.find((item) => item.id === defaultId.value)
  if (!view) return true
  return JSON.stringify(decodeQuery(view.query)) === JSON.stringify(props.applied)
})

/** 保存：日期字段先转相对语义；同名即更新 */
function saveCurrent() {
  const name = saveName.value.trim()
  if (!name) return
  const existed = views.value.some((view) => view.name === name)
  save(name, encodeQuery({ ...props.applied }), { ...props.sort })
  saveName.value = ''
  message.success(existed ? '视图已更新' : '视图已保存')
}

function encodeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const fields = new Set(props.dateFields ?? [])
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) {
    result[key] = fields.has(key) && matchDateRangePreset(value) ? { preset: matchDateRangePreset(value) } : value
  }
  return result
}

function decodeQuery(query: Record<string, unknown>): Record<string, unknown> {
  const fields = new Set(props.dateFields ?? [])
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) {
    result[key] = fields.has(key) && value && typeof value === 'object' && !Array.isArray(value) ? (resolveDateRangePreset((value as { preset?: string }).preset) ?? value) : value
  }
  return result
}

function applyView(view: { id: string; name: string }) {
  const loaded = loadView(view.id)
  if (!loaded) return
  emit('apply-view', { ...loaded, query: decodeQuery(loaded.query), name: view.name })
}

function startRename(view: { id: string; name: string }) {
  editingId.value = view.id
  editingName.value = view.name
}

function confirmRename(id: string) {
  rename(id, editingName.value)
  editingId.value = undefined
}
</script>

<style scoped>
.filter-views-panel { width: 264px; }
.panel-note { margin: 0 0 8px; color: var(--color-text-tertiary); font-size: 12px; }
.panel-empty { margin: 4px 0 8px; color: var(--color-text-tertiary); text-align: center; }
.view-list { max-height: 240px; overflow-y: auto; margin-bottom: 8px; }
.view-row { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 2px 0; }
.view-row.is-editing { flex-wrap: wrap; }
.view-name {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.view-name:hover { background: var(--color-layer-01); }
.view-name .star { color: #d48806; }
.view-actions { display: inline-flex; align-items: center; gap: 0; }
.panel-save { display: flex; gap: 6px; padding-top: 8px; border-top: var(--rule); }
</style>
