<template>
  <button ref="triggerRef" type="button" class="trigger" aria-label="搜索菜单" title="搜索菜单（Ctrl / ⌘ + K）" @click="show">
    <SearchOutlined />
  </button>
  <a-modal v-model:open="open" title="搜索菜单" :footer="null" :width="600" :destroy-on-close="true" :after-close="restoreFocus">
    <a-input ref="inputRef" v-model:value="query" placeholder="搜索页面名称、别名或路径" allow-clear
      role="combobox" aria-label="搜索菜单" aria-autocomplete="list" aria-controls="menu-search-results"
      :aria-expanded="true" :aria-activedescendant="results[selected] ? `menu-search-option-${selected}` : undefined" @keydown="onInputKey" />
    <div class="menu-search-help">↑ ↓ 选择 · Enter 打开 · Esc 关闭<span v-if="!query"> · 最近访问在前</span></div>
    <p v-if="navigationError" role="alert">{{ navigationError }}</p>
    <div id="menu-search-results" class="menu-search-results" role="listbox" aria-label="可访问页面">
      <button v-for="(item, index) in results" :id="`menu-search-option-${index}`" :key="item.path" type="button" role="option"
        :aria-selected="selected === index" :tabindex="-1" class="menu-search-item" :class="{ selected: selected === index }"
        @mouseenter="selected = index" @click="navigate(item.path)">
        <strong>{{ item.name }}</strong><span>{{ item.breadcrumb }}</span>
      </button>
      <div v-if="!results.length" class="menu-search-empty" role="status">没有匹配的可访问页面</div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, isNavigationFailure, NavigationFailureType } from 'vue-router'
import { SearchOutlined } from '@ant-design/icons-vue'
import { useAppStore } from '@/stores/app'
import { FIXED_MENU_ENTRIES } from '@/router/fixed-entries'
import type { MenuItem } from '@/api/auth'

const app = useAppStore()
const router = useRouter()
const open = ref(false)
const query = ref('')
const selected = ref(0)
const navigationError = ref('')
const inputRef = ref<{ focus: () => void }>()
const triggerRef = ref<HTMLButtonElement>()
const recent = ref<string[]>([])
let trigger: HTMLElement | null = null
const historyKey = () => app.userInfo?.id ? `starter-menu-search:${app.userInfo.id}` : undefined
watch(() => app.userInfo?.id, () => {
  recent.value = []
  query.value = ''
  open.value = false
  const key = historyKey()
  if (!key) return
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) || '[]')
    if (Array.isArray(stored)) recent.value = stored.filter((path): path is string => typeof path === 'string').slice(0, 10)
  } catch { /* 存储不可用仍可搜索 */ }
}, { immediate: true })

const items = computed(() => {
  const result: { name: string; path: string; breadcrumb: string; searchable: string }[] = []
  const paths = new Set<string>()
  function collect(menus: MenuItem[], ancestors: string[] = [], depth = 0) {
    if (depth > 20) return
    for (const menu of menus) {
      if (menu.type === 'button') continue
      const trail = [...ancestors, menu.name]
      if (/^\/(?!\/)/.test(menu.path || '') && !/[?#]/.test(menu.path) && !paths.has(menu.path)) {
        const route = router.resolve(menu.path)
        if (route.matched.some(record => record.path !== '/:pathMatch(.*)*')) {
          const aliases = Array.isArray(route.meta.searchAliases) ? route.meta.searchAliases.filter(alias => typeof alias === 'string') : []
          paths.add(menu.path)
          result.push({ name: menu.name, path: menu.path, breadcrumb: trail.join(' / '), searchable: [...trail, menu.path, ...aliases].join(' ').toLocaleLowerCase() })
        }
      }
      if (menu.children?.length) collect(menu.children, trail, depth + 1)
    }
  }
  if (app.userInfo) {
    collect(app.menus)
    // 与路由守卫始终放行的已登录入口一致（fixed-entries 单一来源）。
    collect(FIXED_MENU_ENTRIES.map((entry, index) => ({ id: -(index + 1), name: entry.name, path: entry.path, icon: '' })))
  }
  return result
})
const results = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.value.filter(item => terms.every(term => item.searchable.includes(term))).sort((a, b) => {
    if (terms.length) return 0
    const aIndex = recent.value.indexOf(a.path), bIndex = recent.value.indexOf(b.path)
    return (aIndex < 0 ? 100 : aIndex) - (bIndex < 0 ? 100 : bIndex)
  })
})
watch(results, () => { selected.value = 0 })
async function show() {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  query.value = ''
  selected.value = 0
  navigationError.value = ''
  open.value = true
  await nextTick()
  inputRef.value?.focus()
}
function restoreFocus() {
  const target = trigger?.isConnected && trigger !== document.body && trigger.getClientRects().length ? trigger : triggerRef.value
  target?.focus()
}
async function navigate(path: string) {
  if (!items.value.some(item => item.path === path)) return
  navigationError.value = ''
  try {
    const failure = await router.push(path)
    if (failure && !isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      navigationError.value = '页面未能打开，请稍后重试'
      return
    }
  } catch {
    navigationError.value = '页面加载失败，请重试'
    return
  }
  recent.value = [path, ...recent.value.filter(item => item !== path)].slice(0, 10)
  const key = historyKey()
  try { if (key) sessionStorage.setItem(key, JSON.stringify(recent.value)) } catch { /* 保留本次内存历史 */ }
  open.value = false
}
function onInputKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!results.value.length) return
    selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
    void nextTick(() => document.getElementById(`menu-search-option-${selected.value}`)?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter' && results.value[selected.value]) {
    event.preventDefault()
    void navigate(results.value[selected.value]!.path)
  }
}
function shortcut(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return
  // 其他模态正在编辑时保留其焦点和输入；入口按钮也受模态遮罩保护。
  if (!open.value && Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(dialog =>
    dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden' && dialog.getAttribute('aria-hidden') !== 'true')) return
  event.preventDefault()
  if (open.value) open.value = false
  else void show()
}
onMounted(() => window.addEventListener('keydown', shortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', shortcut))
</script>

<style scoped>
.trigger { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 0; background: transparent; color: var(--color-text-primary); cursor: pointer; }
.menu-search-help { color: var(--color-text-tertiary); font-size: var(--text-aux); margin: var(--space-3) 0; }
.menu-search-results { max-height: min(380px, 50dvh); overflow-y: auto; border: var(--rule); }
.menu-search-item { display: flex; flex-direction: column; gap: var(--space-1); width: 100%; padding: var(--space-3); border: 0; border-bottom: var(--rule); background: var(--color-surface); color: var(--color-text-primary); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.menu-search-item:last-child { border-bottom: 0; }
.menu-search-item.selected { background: var(--color-layer-01); box-shadow: inset 3px 0 var(--color-primary); }
.menu-search-item span, .menu-search-empty { font-size: var(--text-aux); color: var(--color-text-tertiary); }
.menu-search-empty { padding: var(--space-4); }
</style>
