<template>
  <section class="history-panel" aria-label="单据履历">
    <form class="history-filters" @submit.prevent="search">
      <label>动作<select v-model="filters.action"><option value="">全部动作</option><option v-for="(label, code) in actionLabels" :key="code" :value="code">{{ label }}</option></select></label>
      <label>操作人<input v-model.trim="filters.actorName" type="text" maxlength="50" placeholder="输入姓名" /></label>
      <label>开始日期<input v-model="filters.from" type="date" /></label>
      <label>结束日期<input v-model="filters.to" type="date" /></label>
      <a-button html-type="submit" :disabled="loading">查询</a-button>
      <a-button :disabled="loading" @click="reset">重置</a-button>
    </form>
    <div v-if="eventId" class="history-focus">定位事件 #{{ eventId }} <a-button size="small" @click="emit('clear-focus')">查看全部修改</a-button></div>
    <div v-if="error" role="alert" class="history-error">{{ error }} <a-button @click="load(false, true)">重试</a-button></div>
    <p v-if="loading" role="status">正在加载履历…</p>
    <p v-if="!loading && !error && !rows.length" class="history-empty">{{ filtered ? '[ 没有符合条件的履历 ]' : tab === 'activity' ? '[ 暂无已记录动态 ]' : tab === 'changes' ? '[ 暂无已记录修改 ]' : '[ 暂无操作日志 ]' }}</p>
    <template v-if="tab === 'activity'">
      <div v-for="group in groups" :key="group.date" class="activity-day">
        <h3 class="activity-date"><span class="activity-date-icon" aria-hidden="true">◷</span>{{ group.date }}</h3>
        <article v-for="event in group.events" :key="event.id" class="activity-event">
          <div class="activity-heading">
            <strong>{{ event.actorName }}</strong>
            <time :datetime="event.occurredAt">{{ clockOf(event.occurredAt) }}</time>
          </div>
          <div class="activity-object"><span>{{ activityActionLabels[event.action] || actionLabels[event.action] }}</span><span class="activity-object-label">单据标题：</span><span>{{ event.objectLabel }}</span></div>
          <div v-if="changeSummary(event)" class="activity-change">
            <span>{{ changeSummary(event) }}</span>
            <a-button class="activity-view-changes" size="small" type="link" @click="emit('locate', event.id)">查看修改</a-button>
          </div>
        </article>
      </div>
    </template>
    <div v-else-if="tab === 'operations' && rows.length" class="history-scroll">
      <table><thead><tr><th class="col-event-id">序号</th><th class="col-event-time">时间</th><th>操作人</th><th>动作 / 结果</th><th>对象</th><th>版本 / 来源</th></tr></thead><tbody>
        <tr v-for="event in rows" :key="event.id"><td>{{ event.id }}</td><td class="history-time">{{ time(event.occurredAt) }}</td><td>{{ event.actorName }}</td><td class="history-action">{{ actionLabels[event.action] }} · {{ event.result === 'accepted' ? '已受理' : event.result === 'no_change' ? '无变化' : '成功' }}</td><td class="history-text">{{ event.objectLabel }}</td><td class="history-source" :title="`v${event.version} · ${sourceLabel(event)}`">v{{ event.version }} · {{ sourceLabel(event) }}</td></tr>
      </tbody></table>
    </div>
    <template v-else-if="tab === 'changes'">
      <article v-for="event in rows" :key="event.id" class="history-event" :data-event-id="event.id">
        <h3><small>#{{ event.id }}</small></h3>
        <div class="history-scroll"><table><thead><tr><th class="col-actor">修改人</th><th class="col-day">修改日</th><th class="col-clock">修改时间</th><th class="col-field">字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>
          <tr v-for="(change, index) in event.changes" :key="change.id">
            <!-- 同一事件的修改人、日期和时间跨行合并显示。 -->
            <td v-if="index === 0" :rowspan="event.changes?.length ?? 1">{{ event.actorName }}</td>
            <td v-if="index === 0" :rowspan="event.changes?.length ?? 1" class="history-time">{{ dayOf(event.occurredAt) }}</td>
            <td v-if="index === 0" :rowspan="event.changes?.length ?? 1" class="history-time">{{ clockOf(event.occurredAt) }}</td>
            <th>{{ change.fieldLabel }}</th><td><details v-if="display(change.beforeValue, change.beforeLabel).length > 100"><summary>{{ display(change.beforeValue, change.beforeLabel).slice(0, 100) }}… 展开</summary><p class="history-text">{{ display(change.beforeValue, change.beforeLabel) }}</p></details><span v-else class="history-text">{{ display(change.beforeValue, change.beforeLabel) }}</span></td><td><details v-if="display(change.afterValue, change.afterLabel).length > 100"><summary>{{ display(change.afterValue, change.afterLabel).slice(0, 100) }}… 展开</summary><p class="history-text">{{ display(change.afterValue, change.afterLabel) }}</p></details><span v-else class="history-text">{{ display(change.afterValue, change.afterLabel) }}</span></td></tr>
        </tbody></table></div>
      </article>
    </template>
    <div v-if="rows.length" class="history-pager">
      <template v-if="tab === 'activity'"><a-button v-if="result?.nextCursor" :disabled="loading" @click="load(true)">加载更多</a-button><span v-else>已显示全部</span></template>
      <template v-else><a-button size="small" :disabled="loading || page <= 1" @click="page--; load()">上一页</a-button><span>第 {{ page }} 页 / {{ result?.total || 0 }} 条</span><a-button size="small" :disabled="loading || page * (result?.pageSize ?? HISTORY_PAGE_SIZE) >= (result?.total || 0)" @click="page++; load()">下一页</a-button></template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { getExampleHistory, type ExampleEvent, type HistoryResult, type HistoryTab } from '@/api/example'
const props = defineProps<{ recordId: number; tab: Exclude<HistoryTab, 'detail'>; revision: number; eventId?: number }>()
const emit = defineEmits<{ (e: 'locate', id: number): void; (e: 'clear-focus'): void }>()
/** 与后端 ExampleHistoryQuery 的默认页大小一致；服务端每次都会回传实际 pageSize。 */
const HISTORY_PAGE_SIZE = 20
const actionLabels: Record<string, string> = { create: '创建', update: '修改', delete: '删除', restore: '恢复', view: '查看', print: '发起打印', no_change: '无变化保存', attachment_upload: '上传附件', attachment_delete: '删除附件', attachment_restore: '恢复附件' }
const activityActionLabels: Record<string, string> = { create: '创建了单据', update: '修改了单据', delete: '删除了单据', restore: '恢复了单据', view: '查看了单据', print: '发起了单据打印', no_change: '保存了单据（无字段变化）' }
const filters = reactive({ action: '', actorName: '', from: '', to: '' })
const rows = ref<ExampleEvent[]>([]), result = ref<HistoryResult>(), loading = ref(false), error = ref(''), page = ref(1)
let generation = 0, retryAppend = false
const filtered = computed(() => Object.values(filters).some(Boolean) || !!props.eventId)
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const dayFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
const clockFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
function time(value: string) { return timeFormat.format(new Date(value)) }
function dayOf(value: string) { return dayFormat.format(new Date(value)) }
function clockOf(value: string) { return clockFormat.format(new Date(value)) }
function sourceLabel(event: ExampleEvent) { return `${event.source === 'import' ? 'Excel 导入' : '网页'}${event.batchId ? ` · 批次 ${event.batchId}${event.rowNumber ? ` · 第 ${event.rowNumber} 行` : ''}` : ''}` }
/** 动态摘要：展示前两个字段变化（含负责人改派），更多折叠为计数；明细经「查看修改」进入修改日志。 */
function changeSummary(event: ExampleEvent): string {
  const changes = event.changes ?? []
  if (!changes.length) return ''
  const shown = changes.slice(0, 2).map(change => `${change.fieldLabel}：${display(change.beforeValue, change.beforeLabel)} → ${display(change.afterValue, change.afterLabel)}`)
  if (changes.length > 2) shown.push(`另修改 ${changes.length - 2} 个字段`)
  return shown.join('；')
}
function display(value: unknown, label: string | null) {
  if (label != null) return label
  if (value === undefined) return '历史未记录'
  if (value === null || value === '') return '未填写'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}
const groups = computed(() => {
  const map = new Map<string, ExampleEvent[]>()
  for (const event of rows.value) { const date = dateFormat.format(new Date(event.occurredAt)); map.set(date, [...(map.get(date) ?? []), event]) }
  return [...map].map(([date, events]) => ({ date, events }))
})
async function load(append = false, retry = false) {
  if (retry) append = retryAppend
  retryAppend = append
  const current = ++generation
  loading.value = true; error.value = ''
  try {
    const params: Record<string, unknown> = { page: page.value, pageSize: HISTORY_PAGE_SIZE }
    for (const [key, value] of Object.entries(filters)) if (value) params[key] = value
    if (result.value) params.upper = result.value.upper
    if (append && result.value?.nextCursor) params.cursor = result.value.nextCursor
    if (props.eventId) params.eventId = props.eventId
    const data = await getExampleHistory(props.recordId, props.tab, params)
    if (current !== generation) return
    rows.value = append ? [...rows.value, ...data.list] : data.list; result.value = data
  } catch (e) { if (current === generation) error.value = (e as any)?.response?.data?.message || '履历加载失败，请重试' }
  finally { if (current === generation) loading.value = false }
}
function search() { generation++; rows.value = []; result.value = undefined; page.value = 1; void load() }
function reset() { Object.assign(filters, { action: '', actorName: '', from: '', to: '' }); search() }
watch(() => [props.recordId, props.tab, props.revision, props.eventId], () => {
  if (props.eventId) Object.assign(filters, { action: '', actorName: '', from: '', to: '' })
  search()
}, { immediate: true })
onBeforeUnmount(() => generation++)
</script>

<style scoped>
/* 面板占满抽屉内容高度：分页行才能贴底；内容超高时仍由 .detail-content 滚动。 */
.history-panel { display: flex; flex-direction: column; min-height: 100%; }
.history-filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); margin-block: var(--space-1); }
.history-filters label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-aux); }
.history-filters input,.history-filters select { width: 140px; max-width: 100%; min-height: var(--control-h); border: var(--rule); border-radius: 4px; background: var(--color-surface); padding: var(--space-1); }
.history-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--text-aux); min-width: 640px; table-layout: fixed; }
.col-event-id { width: 65px; }
.col-event-time { width: 190px; }
.history-action { white-space: nowrap; }
.history-source { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 修改日志的基本信息列定宽，剩余宽度留给修改前 / 修改后的长文本。 */
.col-actor { width: 100px; }
.col-day { width: 96px; }
.col-clock { width: 88px; }
.col-field { width: 110px; }
.history-time { white-space: nowrap; }
th,td { text-align: left; vertical-align: top; border-bottom: var(--rule); padding: var(--space-2); overflow-wrap: anywhere; }
th { background: var(--color-layer-01); }
.history-event { border-left: 2px solid var(--color-text-secondary); padding: var(--space-3); margin-block: var(--space-2); background: var(--color-layer-01); }
.activity-day { position: relative; margin-left: 8px; padding: var(--space-2) 0 var(--space-3) 24px; border-left: 2px solid var(--color-border-subtle); }
.activity-date { position: relative; margin: 0 0 var(--space-3); color: var(--color-text-primary); font-size: 14px; }
.activity-date-icon { position: absolute; left: -33px; top: 0; display: grid; place-items: center; width: 16px; height: 16px; border: 1.5px solid #4385ff; border-radius: 50%; background: var(--color-surface); color: #4385ff; font-size: 13px; line-height: 1; }
.activity-event { position: relative; border: var(--rule); border-radius: 10px; background: var(--color-surface); padding: var(--space-3); margin-bottom: var(--space-3); box-shadow: 0 2px 10px rgba(15, 0, 0, 0.08); }
.activity-event::before { content: ''; position: absolute; left: -31px; top: 17px; width: 10px; height: 10px; border-radius: 50%; background: #4385ff; }
.activity-event::after { content: ''; position: absolute; left: -7px; top: 16px; width: 12px; height: 12px; border-left: var(--rule); border-bottom: var(--rule); background: var(--color-surface); transform: rotate(45deg); }
.activity-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.activity-heading strong { color: var(--color-text-primary); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.activity-heading time { color: var(--color-text-secondary); font-size: 13px; }
.activity-heading time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.activity-object { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: var(--space-2); row-gap: var(--space-1); margin-top: var(--space-2); color: var(--color-text-primary); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.activity-object-label { color: var(--color-text-secondary); font-size: 13px; }
.activity-object > :last-child { min-width: 0; white-space: pre-wrap; }
.activity-change { margin-top: var(--space-1); color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
h3 { font-size: var(--text-aux); margin-block: var(--space-2); }
.history-text { white-space: pre-wrap; overflow-wrap: anywhere; }
/* 分页行贴底固定，同外层列表 ListFooter 的页脚语言：短内容 margin-top:auto 落底，
   长内容滚动时 sticky 贴底，右对齐。 */
.history-pager { position: sticky; bottom: 0; margin-top: auto; display: flex; gap: var(--space-1); align-items: center; flex-wrap: wrap; justify-content: flex-end; padding: var(--space-1) 0; font-size: 12px; background: var(--color-surface); border-top: var(--rule); }
.history-pager :deep(.ant-btn) { height: 22px; padding-block: 0; font-size: 12px; }
.history-error { color: var(--color-danger); }
.history-focus { padding: var(--space-2); border: var(--rule); }
@media(max-width:600px) { .history-filters label { flex: 1 1 40%; min-width: 0; } .history-filters input,.history-filters select { width: 100%; } }
</style>
