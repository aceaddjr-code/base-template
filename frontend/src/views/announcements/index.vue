<template>
  <Page title="历史公告" description="登录以来发布的全部公告，按发布时间倒序。">
    <div class="history-page">
      <a-spin :spinning="loading">
        <div v-if="list.length" class="announcement-list">
          <button v-for="item in list" :key="item.id" type="button" class="announcement-row" @click="openDetail(item)">
            <span class="row-title">{{ item.title }}</span>
            <span class="row-time">{{ formatDateTime(item.publishedAt) }}</span>
          </button>
        </div>
        <a-empty v-else-if="!loading" description="还没有已发布的公告" />
        <div class="history-footer">
          <a-pagination
            :current="page"
            :page-size="pageSize"
            :total="total"
            :show-size-changer="false"
            :hide-on-single-page="total <= pageSize"
            @change="(p: number) => fetchList(p)"
          />
        </div>
      </a-spin>
    </div>
    <AnnouncementDetailModal :open="detailOpen" :announcement-id="detailId" @close="detailOpen = false" />
  </Page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getPublishedAnnouncements, type AnnouncementBrief } from '@/api/announcement'
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal.vue'
import { formatDateTime } from '@/utils/format'

const loading = ref(false)
const list = ref<AnnouncementBrief[]>([])
const page = ref(1)
const pageSize = 15
const total = ref(0)

async function fetchList(targetPage = page.value) {
  loading.value = true
  try {
    const res = await getPublishedAnnouncements({ page: targetPage, pageSize })
    list.value = res.list
    total.value = res.total
    page.value = res.page
  } catch {
    /* 拦截器已提示；保持空态 */
  } finally {
    loading.value = false
  }
}

const detailOpen = ref(false)
const detailId = ref<number | null>(null)
function openDetail(item: AnnouncementBrief) {
  detailId.value = item.id
  detailOpen.value = true
}

onMounted(() => fetchList(1))
</script>

<style scoped>
.history-page { max-width: 760px; }
.announcement-list { display: flex; flex-direction: column; }
.announcement-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  width: 100%;
  padding: 12px 8px;
  border: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}
.announcement-row:hover { background: var(--color-layer-01); }
.row-title { overflow-wrap: anywhere; }
.row-time { color: var(--color-text-tertiary); font-size: var(--text-aux); white-space: nowrap; }
.history-footer { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
