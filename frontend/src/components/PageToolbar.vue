<template>
  <div class="page-toolbar" :class="{ 'is-sticky': sticky }" :style="stickyOffset ? { top: stickyOffset } : undefined">
    <!-- 左侧：整块插槽 或 搜索框 或 自定义搜索插槽 -->
    <div class="pt-left">
      <slot name="left">
        <slot name="search">
          <a-input-search
            v-if="keyword !== undefined || showSearch"
            v-model:value="kw"
            :placeholder="searchPlaceholder"
            :style="searchWidth ? { width: searchWidth } : undefined"
            allow-clear
            enter-button="搜索"
            @search="onSearch"
          />
        </slot>
      </slot>
    </div>

    <div class="pt-right">
      <a-tooltip :title="createLabel">
        <a-button v-if="showCreate" v-access="createAccess" type="primary" class="h-9!" @click="emit('create')">
          {{ createLabel }}
        </a-button>
      </a-tooltip>

      <a-tooltip v-if="menuItems.some(hasItem)" title="更多功能">
        <a-dropdown trigger="click" placement="bottomRight" @open-change="onFuncVisible">
          <a-button class="w-9! h-9! px-0!" aria-label="更多功能">
            <setting-outlined class="text-base!" />
          </a-button>
        <template #overlay>
          <a-menu @click="onMenuClick">
            <a-menu-item v-if="hasItem('import')" v-access="importAccess" key="import"><upload-outlined />导入</a-menu-item>
            <a-menu-item v-if="hasItem('export')" v-access="exportAccess" key="export"><download-outlined />导出</a-menu-item>
            <a-menu-item v-if="hasItem('columns')" key="columns"><setting-outlined />列设置</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      </a-tooltip>

      <!-- 列设置弹层：锚点覆盖「功能」按钮（视觉上从功能按钮展开成面板） -->
      <a-dropdown
        v-if="hasItem('columns')"
        trigger="click"
        placement="bottomRight"
        :open="columnOpen"
        @update:open="(v: boolean) => (columnOpen = v)"
      >
        <span class="pt-anchor" />
        <template #overlay>
          <ColumnPanel
            v-if="allColumns || columns"
            :preferences="preferences"
            :widths="widths"
          />
        </template>
      </a-dropdown>

      <slot name="actions" />
    </div>

    <!-- 内置导入弹窗:无预检时 选文件 → 确认 → importHandler;有预检时 选文件 → 预检 → 确认导入 -->
    <a-modal
      v-model:open="importVisible"
      :title="importTitle"
      :confirm-loading="importLoading"
      width="520px"
      :ok-text="result ? '已完成' : hasPrecheck && !preview ? '开始预检' : '导入'"
      :cancel-text="preview && !result ? (importLoading ? '后台导入中…' : '取消导入') : '关闭'"
      :ok-button-props="{ disabled: hasPrecheck && !!result }"
      :cancel-button-props="preview && !result ? { disabled: importLoading } : {}"
      @cancel="onImportCancel"
      @ok="doImport"
    >
      <slot name="import-extra" />

      <template v-if="!preview && !result">
        <div v-if="props.importTemplateUrl" class="pt-template-row">
          <a-button type="link" size="small" class="pt-template-link" @click="downloadTemplate">
            <download-outlined /> 下载导入模板
          </a-button>
        </div>
        <a-upload
          :show-upload-list="false"
          :accept="importAccept"
          :before-upload="pickFile"
          :disabled="importLoading"
        >
          <a-button :loading="importLoading" block class="pt-upload-btn">
            <file-excel-outlined />
            选择 Excel 文件（.xlsx / .xls）
          </a-button>
        </a-upload>
        <div v-if="fileName" class="pt-file-name">{{ fileName }}</div>
      </template>

      <template v-else-if="preview && !result">
        <div class="pt-preview" role="status">
          <p class="pt-preview-stats">
            共 <strong>{{ preview.total }}</strong> 行：可导入 <strong>{{ preview.valid }}</strong> 行，错误 <strong :class="preview.errors.length ? 'pt-err-count' : ''">{{ preview.errors.length }}</strong> 行
          </p>
          <p v-if="preview.errors.length" class="pt-preview-note">确认导入将跳过错误行，仅导入其余 {{ preview.valid }} 行。</p>
          <p v-else class="pt-preview-note">全部行均可导入。</p>
          <ul v-if="preview.errors.length" class="pt-err-list">
            <li v-for="err in preview.errors.slice(0, 10)" :key="err.row">第 {{ err.row }} 行：{{ err.message }}</li>
            <li v-if="preview.errors.length > 10" class="pt-err-more">
              <button type="button" class="pt-err-download" @click="downloadErrorFile">…共 {{ preview.errors.length }} 条错误，下载完整错误文件</button>
            </li>
          </ul>
        </div>
      </template>

      <template v-else-if="result">
        <div class="pt-preview" role="status">
          <p class="pt-preview-stats">
            导入完成：<strong>{{ result.imported }}</strong> / {{ result.total }} 条成功<template v-if="result.errors.length">，失败 <strong>{{ result.errors.length }}</strong> 条</template>
          </p>
          <ul v-if="result.errors.length" class="pt-err-list">
            <li v-for="err in result.errors.slice(0, 10)" :key="err.row">第 {{ err.row }} 行：{{ err.message }}</li>
            <li v-if="result.errors.length > 10" class="pt-err-more">
              <button type="button" class="pt-err-download" @click="downloadErrorFile">…共 {{ result.errors.length }} 条失败，下载完整错误文件</button>
            </li>
          </ul>
        </div>
      </template>
    </a-modal>

  </div>
</template>

<script setup lang="ts">

import { ref, computed } from 'vue'
import {
  SettingOutlined,
  UploadOutlined,
  DownloadOutlined,
  FileExcelOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import ColumnPanel from './ColumnPanel.vue'
import { downloadCsv } from '@/utils/csv-download'

type MenuItemKey = 'import' | 'export' | 'columns'

const props = withDefaults(
  defineProps<{
    /** 左侧关键词（v-model，undefined 时不渲染搜索框） */
    keyword?: string
    searchPlaceholder?: string
    searchWidth?: string
    /** 新增按钮文案（默认「新增」） */
    createLabel?: string

    showCreate?: boolean
    /** 功能菜单项（按页面能力配置；默认 导入/导出/列设置） */
    menuItems?: MenuItemKey[]
    /** 新增按钮权限码 */
    createAccess?: string[]
    /** 导入菜单项权限码 */
    importAccess?: string[]
    /** 导出菜单项权限码 */
    exportAccess?: string[]
    // ===== 导入 =====
    /** 导入处理器（选择文件后回调；内置统一弹窗） */
    importHandler?: (file: File) => Promise<void> | void
    importTitle?: string
    importAccept?: string
    /** 导入弹窗打开时回调（页面加载前置选择数据，如令号列表） */
    onImportOpen?: () => void
    /** 预检（F30）：解析并校验全部行,不写数据;返回统计与逐行错误 */
    importPrecheck?: (file: File) => Promise<{ total: number; valid: number; errors: { row: number; message: string }[] }>
    /** 确认导入（F30）：部分成功语义,返回完整结果 */
    importConfirm?: (file: File) => Promise<{ imported: number; total: number; errors: { row: number; message: string }[] }>
    /** 导入模板下载地址（F30）：提供后弹窗内出现"下载模板" */
    importTemplateUrl?: string
    // ===== 导出 =====
    /** 导出 URL（菜单点击时 window.open，点击驱动不受弹窗拦截） */
    exportUrl?: string
    // ===== 列设置 =====
    columns?: any[]
    /** 列定义全集（含默认隐藏列）——列设置面板的可选来源；不传时回退 columns */
    allColumns?: any[]
    columnSettingsKey?: string
    lockedKeys?: string[]
    /** 列宽的非拖拽入口（F35）：传入后列设置面板显示宽度编辑；来自页面的 useResizableColumns */
    resizable?: { colWidths: Record<string, number>; setColumnWidth: (key: string | number, width: number) => void }
    // ===== 吸顶 =====
    sticky?: boolean
    stickyOffset?: string

    showSearch?: boolean
  }>(),
  {
    keyword: undefined,
    searchPlaceholder: '搜索',
    searchWidth: '280px',
    createLabel: '新增',
    showCreate: false,
    menuItems: () => [],
    createAccess: undefined,
    importAccess: undefined,
    exportAccess: undefined,
    importHandler: undefined,
    importTitle: 'Excel 导入',
    importAccept: '.xlsx,.xls',
    onImportOpen: undefined,
    exportUrl: '',
    columns: undefined,
    allColumns: undefined,
    columnSettingsKey: '',
    lockedKeys: undefined,
    sticky: true,
    stickyOffset: '',
    showSearch: true,
  },
)

const emit = defineEmits<{
  (e: 'update:keyword', v: string): void
  (e: 'update:columns', cols: any[]): void
  (e: 'create'): void
  (e: 'imported'): void
}>()

const kw = ref(props.keyword ?? '')
import { watch } from 'vue'
watch(
  () => props.keyword,
  (v) => {
    if (kw.value !== v) kw.value = v ?? ''
  },
)
function onSearch(v: string) {
  emit('update:keyword', v)
}

/** 导入能力：直连模式（importHandler）或预检模式（importPrecheck + importConfirm 成对出现） */
const canImport = computed(() => !!props.importHandler || (!!props.importPrecheck && !!props.importConfirm))

function hasItem(key: MenuItemKey): boolean {
  if (!props.menuItems.includes(key)) return false
  if (key === 'import') return canImport.value
  if (key === 'export') return !!props.exportUrl
  return !!(props.allColumns ?? initialColumns).length
}

import { useColumnConfig } from '@/composables/useColumnConfig'
const initialColumns = [...(props.columns ?? [])]
const preferences = useColumnConfig(props.columnSettingsKey, () => props.allColumns ?? initialColumns, () => props.lockedKeys ?? ['action'])
/** 页面传入 resizable 时，把列宽与落盘方法暴露给面板 */
const widths = computed(() => props.resizable ? { values: props.resizable.colWidths, apply: (key: string, width: number) => props.resizable!.setColumnWidth(key, width) } : undefined)
watch(preferences.visibleColumns, columns => {
  if (props.allColumns || props.columns) emit('update:columns', columns)
}, { immediate: true })

// ===== 功能菜单 =====
const funcOpen = ref(false)
function onFuncVisible(visible: boolean) {
  funcOpen.value = visible
  // vc-dropdown 内部 onClick 会先关功能下拉并触发 open-change(false)，
  // 若在此重置 columnOpen 会与 onMenuClick 的设置同事件内互相覆盖，面板永远打不开。
  // 列设置弹层由独立 a-dropdown 管理（外部点击/update:open 自行关闭）。
}

function onMenuClick({ key }: { key: string }) {
  switch (key) {
    case 'import':
      if (!canImport.value) return message.warning('该页面未配置导入')
      importVisible.value = true
      props.onImportOpen?.()
      break
    case 'export':
      if (props.exportUrl) window.open(props.exportUrl, '_blank')
      else message.warning('该页面未配置导出')
      break
    case 'columns':
      columnOpen.value = true
      break
  }
}

// ===== 列设置弹层（锚点覆盖功能按钮，由菜单项打开） =====
const columnOpen = ref(false)

// ===== 导入 =====
const importVisible = ref(false)
const importLoading = ref(false)
const fileName = ref('')
const pickedFile = ref<File | null>(null)
const preview = ref<{ total: number; valid: number; errors: { row: number; message: string }[] } | null>(null)
const result = ref<{ imported: number; total: number; errors: { row: number; message: string }[] } | null>(null)
const hasPrecheck = computed(() => !!props.importPrecheck)

function downloadErrorFile(): void {
  const source = result.value ?? preview.value
  if (!source || !source.errors.length) return
  downloadCsv('import-errors.csv', ['行号', '错误原因'], source.errors.map((e) => [e.row, String(e.message)]))
}

function pickFile(file: File) {
  fileName.value = file.name
  pickedFile.value = file
  return false // 阻止 a-upload 默认上传
}

// 迟到保护：弹窗关闭后到达的预检/导入响应不再写回（与列表请求的 AbortSignal 口径一致）
const importRun = ref(0)

async function doImport() {
  if (!pickedFile.value) {
    message.warning('请先选择文件')
    return
  }
  importLoading.value = true
  const run = importRun.value
  try {
    // 预检模式（F30）:第一次 OK=开始预检;第二次 OK=确认导入;无预检属性时直连 importHandler
    if (hasPrecheck.value && !preview.value && !result.value) {
      const report = await props.importPrecheck!(pickedFile.value)
      if (run === importRun.value) preview.value = report
      return
    }
    if (hasPrecheck.value && result.value) return
    if (props.importPrecheck && props.importConfirm && preview.value) {
      const outcome = await props.importConfirm(pickedFile.value)
      if (run === importRun.value) { result.value = outcome; emit('imported') }
      return
    }
    await props.importHandler?.(pickedFile.value)
    importVisible.value = false
    fileName.value = ''
    pickedFile.value = null
  } catch {
    /* 页面处理器/拦截器已提示；保留弹窗可换文件重试 */
  } finally {
    importLoading.value = false
  }
}

function onImportCancel(): void {
  // 确认导入进行中取消按钮已禁用;其余关闭丢弃文件与预检结果,确认前放弃不会写入任何数据
  importRun.value++
  importVisible.value = false
  preview.value = null
  result.value = null
  fileName.value = ''
  pickedFile.value = null
}

function downloadTemplate(): void {
  if (props.importTemplateUrl) window.open(props.importTemplateUrl, '_blank')
}

</script>

<style scoped>
.page-toolbar {
  position: sticky;
  top: 0;
  z-index: 30; /* 低于侧边栏 100、弹层 1050，高于表格 fixed 列 z-index 1-2 */
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  background: var(--color-bg-page);
  padding: var(--space-1) 0 var(--space-3);
  flex-wrap: wrap;
}
.pt-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
/* 搜索框与右侧按钮同高：内层 input 会撑高 affix 外壳，所以同时压外壳的高度和内边距。 */
.pt-left :deep(.ant-input-search .ant-input-affix-wrapper) {
  height: var(--control-h);
  padding-block: 0;
  align-items: center;
}
.pt-left :deep(.ant-input-search .ant-input) { height: auto; }
.pt-left :deep(.ant-input-search .ant-input-group-addon .ant-btn) { height: var(--control-h); padding-inline: var(--space-4); }
.pt-right {
  position: relative; /* 列设置锚点定位基准 */
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pt-anchor {
  position: absolute;
  right: 0; /* 覆盖「功能」按钮（图标化后 36px） */
  width: 36px;
  height: 36px;
  pointer-events: none; /* 打开由菜单项控制，锚点仅作定位 */
}
.pt-rotate {
  transform: rotate(180deg);
  transition: transform 0.2s ease;
}
.pt-upload-btn {
  height: 40px;
}
.pt-file-name {
  margin-top: var(--space-2);
  font-size: var(--text-aux);
  color: var(--color-text-secondary);
  word-break: break-all;
}
.pt-template-row { margin-bottom: var(--space-2); text-align: right; }
.pt-template-link { padding: 0; }
.pt-preview { font-size: var(--text-body); line-height: 1.6; }
.pt-preview-stats { margin: 0 0 var(--space-1); }
.pt-preview-note { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font-size: var(--text-aux); }
.pt-err-list {
  max-height: 180px;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  overflow-y: auto;
  border-radius: 4px;
  background: var(--color-layer-hover);
  font-size: var(--text-aux);
}
.pt-err-list li { word-break: break-all; }
.pt-err-count { color: #b42318; }
.pt-err-more { margin-top: 2px; }
.pt-err-download {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--color-link);
  cursor: pointer;
}
.pt-err-download:hover { color: var(--color-link-hover); text-decoration: underline; }
.pt-err-download:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
/* 窄屏：搜索独占一行，操作按钮右对齐，避免 280px 固定宽把「新增」挤掉。 */
@media (max-width: 640px) {
  .page-toolbar { gap: var(--space-2); padding-bottom: var(--space-2); }
  .pt-left { width: 100%; }
  .pt-left :deep(.ant-input-search) { width: 100% !important; }
  .pt-right { width: 100%; justify-content: flex-end; }
}
</style>
