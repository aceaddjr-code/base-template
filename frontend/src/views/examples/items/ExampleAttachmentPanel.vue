<template>
  <section class="attachment-panel" aria-label="附件与图片">
    <div v-if="error" role="alert" class="file-error">{{ error }} <a-button size="small" :disabled="busy" @click="load">刷新列表</a-button></div>
    <p v-if="loading" role="status">正在加载附件和图片…</p>
    <div v-if="pending" class="file-error">文件已上传，尚未保存到单据。<a-button size="small" :disabled="busy" @click="bindPending">重试保存</a-button></div>
    <section v-for="image in [false, true]" :key="String(image)" class="file-section" :aria-label="image ? '图片区域' : '附件区域'">
      <header><h3>{{ image ? '图片' : '附件' }} <small>{{ files.filter(file => file.image === image).length }}</small></h3>
        <label v-if="editable" class="upload-control"><span>{{ busy ? '处理中…' : image ? '上传图片' : '上传附件' }}</span><input type="file" :accept="image ? imageAccept : documentAccept" :disabled="busy || loading || !!pending" @change="upload($event, image)" /></label>
      </header>
      <p v-if="!loading && !error && !files.some(file => file.image === image)" class="file-empty">暂无{{ image ? '图片' : '附件' }}</p>
      <div :class="image ? 'image-grid' : 'file-list'">
        <article v-for="file in files.filter(file => file.image === image)" :key="file.id" class="file-item">
          <a-image v-if="image && file.previewable !== false" :src="exampleFileUrl(recordId, file.id, true)" :alt="file.name" width="100%"><template #placeholder>加载图片中…</template></a-image>
          <a v-if="image && file.previewable === false" class="image-download" :href="exampleFileUrl(recordId, file.id)" :download="file.name"><FileImageOutlined aria-hidden="true" />下载原图</a>
          <div class="file-info"><span class="file-name">{{ file.name }}</span><small>{{ formatSize(file.size) }}</small></div>
          <div class="file-actions"><a :href="exampleFileUrl(recordId, file.id)" :download="file.name">下载</a><a-popconfirm v-if="editable" title="确定删除这个文件？" @confirm="remove(file.id)"><a-button type="link" danger size="small" :disabled="busy">删除</a-button></a-popconfirm></div>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { FileImageOutlined } from '@ant-design/icons-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { getExampleFiles, uploadExampleAttachment, addExampleFile, removeExampleFile, exampleFileUrl, type ExampleFile } from '@/api/example'
import { formatSize, ATTACHMENT_MAX_SIZE } from '@/api/attachment'
const props = defineProps<{ recordId: number; editable: boolean }>()
const emit = defineEmits<{ (event: 'changed'): void; (event: 'state', state: { busy: boolean; pending: boolean }): void }>()
const imageAccept = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.ico,.tif,.tiff,.heic,.heif,.svg'
const documentAccept = '.pdf,.doc,.docx,.dot,.dotx,.xls,.xlsx,.xlsm,.xlt,.xltx,.xltm,.ppt,.pptx,.pps,.ppsx,.odt,.ods,.odp,.rtf,.txt,.csv,.tsv,.md,.log,.json,.xml,.yaml,.yml,.zip,.rar,.7z,.tar,.gz,.bz2,.xz,.dwg,.dxf,.step,.stp,.igs,.iges,.stl,.3dm,.vsd,.vsdx,.psd,.ai,.eps,.mp3,.wav,.m4a,.flac,.mp4,.mov,.avi,.wmv,.mkv'
const files = ref<ExampleFile[]>([]), loading = ref(false), busy = ref(false), error = ref(''), pending = ref<number>()
let generation = 0, disposed = false
const uploadController = new AbortController()
watch([busy, pending], () => emit('state', { busy: busy.value, pending: pending.value != null }), { immediate: true, flush: 'sync' })
function failure(e: unknown) { return (e as any)?.response?.data?.message || (e as Error)?.message || '操作失败，请重试' }
async function load() {
  const current = ++generation; loading.value = true; error.value = ''
  try { const list = await getExampleFiles(props.recordId); if (current === generation) files.value = list }
  catch (e) { if (current === generation) error.value = failure(e) }
  finally { if (current === generation) loading.value = false }
}
async function bindPending() {
  if (!pending.value || busy.value) return
  busy.value = true; error.value = ''
  try { await addExampleFile(props.recordId, pending.value); pending.value = undefined; emit('changed'); await load() }
  catch (e) { error.value = failure(e) }
  finally { busy.value = false }
}
async function upload(event: Event, image: boolean) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || busy.value || pending.value) return
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  const allowed = image ? imageAccept : documentAccept
  if (!allowed.split(',').includes(ext)) { error.value = image ? '请选择支持的图片格式' : '请选择支持的附件格式；图片请在图片区上传'; return }
  if (!file.size || file.size > ATTACHMENT_MAX_SIZE) { error.value = '文件必须非空且不超过 500MB'; return }
  busy.value = true; error.value = ''
  try { const uploaded = await uploadExampleAttachment(file, { errorFeedback: 'form', signal: uploadController.signal }); if (!disposed) pending.value = uploaded.id }
  catch (e) { error.value = failure(e) }
  finally { busy.value = false }
  if (!disposed && pending.value) await bindPending()
}
async function remove(id: number) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await removeExampleFile(props.recordId, id); emit('changed'); await load() }
  catch (e) { error.value = failure(e) }
  finally { busy.value = false }
}
watch(() => props.recordId, () => { files.value = []; pending.value = undefined; void load() }, { immediate: true })
onBeforeUnmount(() => { disposed = true; uploadController.abort(); generation++ })
</script>

<style scoped>
.attachment-panel { padding-block: var(--space-2); --image-card-width: calc(var(--space-5) * 8); --image-preview-height: calc(var(--space-5) * 6); }
.file-section { border: var(--rule); padding: var(--space-3); margin-bottom: var(--space-3); }
header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
h3 { margin: 0; font-size: var(--text-heading); } small,.file-empty { color: var(--color-text-secondary); font-size: var(--text-aux); }
.upload-control { position: relative; display: inline-flex; border: var(--rule); border-radius: var(--space-1); padding: var(--space-1) var(--space-3); font-size: var(--text-aux); cursor: pointer; overflow: hidden; }
.upload-control input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.upload-control:focus-within { outline: var(--focus-width) solid var(--color-primary); }
.file-item { min-width: 0; border-bottom: var(--rule); padding-block: var(--space-2); }
.file-list .file-item { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.file-info { min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.file-name { overflow-wrap: anywhere; font-size: var(--text-aux); }
.file-actions { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; font-size: var(--text-aux); }
.image-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--image-card-width), 100%), 1fr)); gap: var(--space-3); }
.image-grid .file-item { border: var(--rule); padding: var(--space-2); }
.image-grid :deep(img) { object-fit: contain; height: var(--image-preview-height); }
.image-download { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--image-preview-height); color: var(--color-link); font-size: var(--text-aux); }
.file-error { color: var(--color-danger-text); margin-bottom: var(--space-2); font-size: var(--text-aux); }
</style>
