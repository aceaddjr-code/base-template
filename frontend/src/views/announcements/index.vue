<template>
  <Page title="历史公告" description="登录以来发布的全部公告，按发布时间倒序。">
    <template #extra><router-link to="/home">返回首页</router-link></template>
    <div class="history-page">
      <a-spin :spinning="loading">
        <a-alert v-if="failed" type="error" show-icon message="公告加载失败，请重试">
          <template #action><a-button size="small" @click="fetchList(requestedPage)">重试</a-button></template>
        </a-alert>
        <div v-if="list.length" class="announcement-list">
          <AnnouncementRow
            v-for="item in list"
            :key="item.id"
            :title="item.title"
            :time="formatDateTime(item.publishedAt)"
            @open="openDetail(item)"
          />
        </div>
        <a-empty v-else-if="!loading && !failed" description="还没有已发布的公告" />
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
import AnnouncementRow from '@/components/AnnouncementRow.vue'
import { formatDateTime } from '@/utils/format'

const loading = ref(false)
const failed = ref(false)
const list = ref<AnnouncementBrief[]>([])
const page = ref(1)
const requestedPage = ref(1)
const pageSize = 15
const total = ref(0)
let requestVersion = 0

async function fetchList(targetPage = page.value) {
  const version = ++requestVersion
  requestedPage.value = targetPage
  loading.value = true
  failed.value = false
  try {
    const res = await getPublishedAnnouncements({ page: targetPage, pageSize })
    if (version !== requestVersion) return
    list.value = res.list
    total.value = res.total
    page.value = res.page
  } catch {
    if (version === requestVersion) failed.value = true
  } finally {
    if (version === requestVersion) loading.value = false
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
.history-footer { display: flex; justify-content: flex-end; margin-top: var(--space-3); }
</style>
