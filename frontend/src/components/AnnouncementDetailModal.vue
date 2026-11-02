<template>
  <a-modal
    :open="open"
    :title="detail?.title ?? '公告详情'"
    :footer="null"
    :width="640"
    @cancel="emit('close')"
  >
    <div v-if="detail" class="announcement-detail">
      <p class="announcement-meta">
        <span>发布时间：{{ detail.publishedAt ? formatDateTime(detail.publishedAt) : '—' }}</span>
      </p>
      <div class="announcement-content">{{ detail.content }}</div>
    </div>
    <a-empty v-else-if="!loading" description="公告不存在或已撤回" />
    <p v-else class="announcement-loading">加载中…</p>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getAnnouncementDetail, getAnnouncementManagementDetail, type AnnouncementItem } from '@/api/announcement'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ open: boolean; announcementId: number | null; management?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const detail = ref<AnnouncementItem | null>(null)
const loading = ref(false)

watch(() => [props.open, props.announcementId, props.management] as const, async ([open, id, management]) => {
  if (!open || id == null) return
  loading.value = true
  detail.value = null
  try {
    detail.value = await (management ? getAnnouncementManagementDetail(id) : getAnnouncementDetail(id))
  } catch {
    /* 拦截器已提示；保持空态说明 */
  } finally {
    loading.value = false
  }
}, { immediate: true })
</script>

<style scoped>
.announcement-meta { margin: 0 0 12px; color: var(--color-text-tertiary); font-size: var(--text-aux); }
.announcement-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
  min-height: 60px;
  max-height: 55dvh;
  overflow-y: auto;
}
.announcement-loading { color: var(--color-text-tertiary); text-align: center; padding: 24px 0; }
</style>
