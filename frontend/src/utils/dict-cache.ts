import { ref, shallowRef } from 'vue'
import { getDict, getDictAll, type DictData } from '@/api/dict'

type AllDictData = DictData & { options: (DictData['options'][number] & { status: number })[] }

function newAllEntry() {
  return {
    data: shallowRef<AllDictData>(), loading: ref(false), error: shallowRef<unknown>(),
    version: 0, subscribers: 0, pending: undefined as Promise<AllDictData | undefined> | undefined,
  }
}
const allEntries = new Map<string, ReturnType<typeof newAllEntry>>()

export function dictAllEntry(code: string) {
  let entry = allEntries.get(code)
  if (!entry) { entry = newAllEntry(); allEntries.set(code, entry) }
  return entry
}

/** 全量选项（含停用项,F40 历史回显):与启用缓存分账本;invalidateDict 同时失效两份 */
export function loadDictAll(code: string, force = false): Promise<AllDictData | undefined> {
  const entry = dictAllEntry(code)
  if (entry.pending) return entry.pending
  if (!force && entry.data.value) return Promise.resolve(entry.data.value)
  const version = entry.version
  entry.loading.value = true
  entry.error.value = undefined
  const pending = getDictAll(code).then(data => {
    if (version !== entry.version) return undefined
    entry.data.value = data
    return data
  }).catch(error => {
    if (version !== entry.version) return undefined
    entry.error.value = error
    throw error
  }).finally(() => {
    if (entry.pending === pending) {
      entry.pending = undefined
      entry.loading.value = false
    }
  })
  entry.pending = pending
  return pending
}

function newEntry() {
  return {
    data: shallowRef<DictData>(), loading: ref(false), error: shallowRef<unknown>(),
    version: 0, subscribers: 0, pending: undefined as Promise<DictData | undefined> | undefined,
  }
}
const entries = new Map<string, ReturnType<typeof newEntry>>()

export function dictEntry(code: string) {
  let entry = entries.get(code)
  if (!entry) { entry = newEntry(); entries.set(code, entry) }
  return entry
}

/** force 绕过已完成缓存；同一代在途读取仍合并。失效后旧请求不能写回。 */
export function loadDict(code: string, force = false): Promise<DictData | undefined> {
  const entry = dictEntry(code)
  if (entry.pending) return entry.pending
  if (!force && entry.data.value) return Promise.resolve(entry.data.value)
  const version = entry.version
  entry.loading.value = true
  entry.error.value = undefined
  const pending = getDict(code).then(data => {
    if (version !== entry.version) return undefined
    entry.data.value = data
    return data
  }).catch(error => {
    if (version !== entry.version) return undefined
    entry.error.value = error
    throw error
  }).finally(() => {
    if (entry.pending === pending) {
      entry.pending = undefined
      entry.loading.value = false
    }
  })
  entry.pending = pending
  return pending
}

function clearEntry(entry: ReturnType<typeof newEntry>) {
  entry.version++
  entry.pending = undefined
  entry.loading.value = false
  entry.data.value = undefined
  entry.error.value = undefined
}

/** 管理成功后失效对应编码；当前已挂载的使用方即时重新读取。 */
export function invalidateDict(code?: string) {
  for (const [key, entry] of entries) {
    if (code !== undefined && key !== code) continue
    clearEntry(entry)
    if (entry.subscribers > 0) void loadDict(key).catch(() => { /* error ref 与请求层呈现错误 */ })
  }
  for (const [key, entry] of allEntries) {
    if (code !== undefined && key !== code) continue
    clearEntry(entry)
    if (entry.subscribers > 0) void loadDictAll(key).catch(() => { /* error ref 与请求层呈现错误 */ })
  }
}

/** 退出/切换账号只清空，不在失去身份后重新发请求。 */
export function resetDictCache() {
  for (const entry of entries.values()) clearEntry(entry)
  for (const entry of allEntries.values()) clearEntry(entry)
}
