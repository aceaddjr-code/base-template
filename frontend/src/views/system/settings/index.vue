<template>
  <div class="p-6 h-full flex flex-col">
    <a-card :bordered="false" class="flex-1 min-h-0 flex flex-col">
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex justify-between items-center mb-4 gap-3 flex-wrap">
          <a-alert
            type="info"
            show-icon
            class="flex-1 min-w-60"
            message="参数键为代码预登记，页面只维护取值；数据库密码、JWT 密钥等部署配置不在这里修改"
          />
          <a-button @click="fetchList" :loading="loading">刷新</a-button>
        </div>

        <a-table
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
        </a-table>
      </div>
    </a-card>

    <a-modal
      v-model:open="editVisible"
      :title="`编辑参数：${editing?.name ?? ''}`"
      :confirm-loading="editLoading"
      :mask-closable="!editLoading"
      :keyboard="!editLoading"
      ok-text="保存"
      cancel-text="取消"
      @ok="handleSave"
    >
      <div ref="feedbackRoot">
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { getSettings, updateSetting, type SettingItem } from '@/api/setting'
import { useFormFeedback } from '@/composables/useFormFeedback'
import { useAppStore } from '@/stores/app'
import FormFeedback from '@/components/FormFeedback.vue'
import { formatDateTime } from '@/utils/format'

const appStore = useAppStore()

const loading = ref(false)
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
  try {
    list.value = await getSettings()
  } catch {
    /* 拦截器已提示，保留旧列表 */
  } finally {
    loading.value = false
  }
}

// ============ 编辑 ============
const editVisible = ref(false)
const editLoading = ref(false)
const editing = ref<SettingItem | null>(null)
const editForm = reactive({ value: '' })
const feedbackRoot = ref<HTMLElement | null>(null)
const feedback = useFormFeedback({
  root: feedbackRoot,
  fields: () => ({ value: '参数值' }),
  values: () => ({ value: editForm.value }),
})
const { summary: feedbackSummary, requestId: feedbackRequestId, errors: editErrors } = feedback

function openEdit(record: SettingItem) {
  editing.value = record
  editForm.value = record.value
  feedback.clear()
  editVisible.value = true
}

async function handleSave() {
  if (!editing.value || editLoading.value) return
  editLoading.value = true
  try {
    const saved = await updateSetting(editing.value.key, editForm.value, { errorFeedback: 'form' })
    const index = list.value.findIndex((item) => item.key === saved.key)
    if (index >= 0) list.value[index] = saved
    // 公开参数立即反映到品牌名/帮助联系方式，不等重新登录
    if (saved.public) appStore.refreshPublicSettings()
    message.success('保存成功')
    editVisible.value = false
  } catch (error) {
    await feedback.capture(error)
  } finally {
    editLoading.value = false
  }
}

onMounted(fetchList)
</script>

<style scoped>
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
  font-size: 12px;
}
.field-error { margin: 4px 0 0; color: #b42318; }
</style>
