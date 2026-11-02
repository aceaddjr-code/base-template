<template>
  <Page
    class="page-list"
    title="系统设置"
    description="参数键为代码预登记，页面只维护取值；数据库密码、JWT 密钥等部署配置不在这里修改。"
  >
    <template #extra>
      <a-button :loading="loading" @click="fetchList">刷新</a-button>
    </template>

    <a-table
      :ref="setTableRef"
      :columns="columns"
      :data-source="list"
      :loading="loading"
      :pagination="false"
      row-key="key"
      size="middle"
      :scroll="{ x: 'max-content' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'key'">
          <a-tag>{{ record.key }}</a-tag>
        </template>
        <template v-if="column.key === 'value'">
          <span class="setting-value" :title="record.value">{{ record.value || '-' }}</span>
        </template>
        <template v-if="column.key === 'type'">
          {{ record.type === 'text' ? '多行文本' : '文本' }}
        </template>
        <template v-if="column.key === 'public'">
          {{ record.public ? '登录用户可见' : '仅管理员' }}
        </template>
        <template v-if="column.key === 'modified'">
          <a-tag v-if="record.modified" color="processing">已修改</a-tag>
          <a-tag v-else>默认值</a-tag>
        </template>
        <template v-if="column.key === 'updatedAt'">
          {{ record.updatedAt ? formatDateTime(record.updatedAt) : '-' }}
        </template>
        <template v-if="column.key === 'action'">
          <a-button type="link" size="small" @click="openEdit(record as SettingItem)">编辑</a-button>
        </template>
      </template>
      <template #emptyText><a-empty :description="failed ? '加载失败，请刷新重试' : '暂无参数'" /></template>
    </a-table>
    <template #footer><div class="settings-footer"><StickyScrollBar :source="stickySource" /></div></template>
  </Page>

  <a-modal
    :open="editVisible"
    :title="`编辑参数：${editing?.name ?? ''}`"
    v-bind="modalProps"
    ok-text="保存"
    cancel-text="取消"
    @ok="handleSave"
    @cancel="closeModal"
  >
    <div :ref="feedbackRoot">
      <FormFeedback :items="feedbackSummary" :request-id="feedbackRequestId" @focus="feedback.focus" />
      <a-form layout="vertical">
        <a-form-item label="参数键">
          <a-input :value="editing?.key" disabled aria-label="参数键" />
        </a-form-item>
        <a-form-item label="参数说明">
          <p class="setting-desc">{{ editing?.description }}</p>
        </a-form-item>
        <a-form-item label="取值" required data-form-field="value" :validate-status="editErrors.value ? 'error' : undefined">
          <a-textarea
            v-if="editing?.type === 'text'"
            v-model:value="editForm.value"
            :disabled="editLoading"
            :maxlength="editing?.maxLength"
            :rows="3"
            aria-label="参数取值"
            v-bind="feedback.attrs('value')"
          />
          <a-input
            v-else
            v-model:value="editForm.value"
            :disabled="editLoading"
            :maxlength="editing?.maxLength"
            aria-label="参数取值"
            v-bind="feedback.attrs('value')"
          />
          <p v-if="editErrors.value" :id="feedback.errorId('value')" class="field-error">{{ editErrors.value }}</p>
        </a-form-item>
        <p class="setting-default">默认值：{{ editing?.defaultValue || '（空）' }}；清空必填参数会被拒绝，其余参数保存空值即恢复默认语义。</p>
      </a-form>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { getSettings, updateSetting, type SettingItem } from '@/api/setting'
import { useFormModal } from '@/composables/useFormModal'
import { useAppStore } from '@/stores/app'
import FormFeedback from '@/components/FormFeedback.vue'
import Page from '@/components/Page.vue'
import StickyScrollBar from '@/components/StickyScrollBar.vue'
import { useListPage } from '@/composables/useListPage'
import { formatDateTime } from '@/utils/format'

const appStore = useAppStore()
const { setTableRef, stickySource } = useListPage()

const loading = ref(false)
const failed = ref(false)
const list = ref<SettingItem[]>([])

const columns = [
  { title: '参数名称', dataIndex: 'name', key: 'name', width: 120 },
  { title: '参数键', dataIndex: 'key', key: 'key', width: 140 },
  { title: '当前值', dataIndex: 'value', key: 'value', width: 220 },
  { title: '类型', key: 'type', width: 90 },
  { title: '可见性', key: 'public', width: 110 },
  { title: '状态', key: 'modified', width: 90 },
  { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 170 },
  { title: '说明', dataIndex: 'description', key: 'description', width: 260 },
  { title: '操作', key: 'action', width: 80 },
]

async function fetchList() {
  loading.value = true
  failed.value = false
  try {
    list.value = await getSettings()
  } catch {
    /* 拦截器已提示，保留旧列表；failed 驱动空态文案 */
    failed.value = true
  } finally {
    loading.value = false
  }
}

// ============ 编辑 ============
const editing = ref<SettingItem | null>(null)
const editModal = useFormModal<{ value: string }, string>({
  fields: () => ({ value: '参数值' }),
  defaults: () => ({ value: '' }),
  // 必填参数清空由服务端裁决，本地不做校验
  save: async (form, editId) => {
    if (editId == null) return
    const saved = await updateSetting(editId, form.value, { errorFeedback: 'form' })
    const index = list.value.findIndex((item) => item.key === saved.key)
    if (index >= 0) list.value[index] = saved
    // 公开参数立即反映到品牌名/帮助联系方式，不等重新登录
    if (saved.public) appStore.refreshPublicSettings()
    message.success('保存成功')
  },
})
const { visible: editVisible, loading: editLoading, form: editForm, feedback, modalProps, close: closeModal, submit: handleSave } = editModal
const feedbackRoot = editModal.bindRoot
const { summary: feedbackSummary, requestId: feedbackRequestId, errors: editErrors } = feedback

function openEdit(record: SettingItem) {
  editing.value = record
  editModal.open(record.key, { value: record.value })
}

onMounted(fetchList)
</script>

<style scoped>
/* 本页是无分页的参数全量列表：page-list 默认把底边交给页脚，这里自行补一条闭合线。 */
.page-list :deep(.ant-table-tbody > tr:last-child > td) { border-bottom: var(--rule); }
.settings-footer { flex-shrink: 0; border-top: var(--rule); background: var(--color-surface); }
.setting-value {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.setting-desc {
  margin: 0;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
.setting-default {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--text-aux);
}
</style>
