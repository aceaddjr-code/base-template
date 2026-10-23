import { defineComponent, h, ref, watch, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import MenuSearch from './MenuSearch.vue'
import { useAppStore } from '@/stores/app'

const Modal = defineComponent({ props: ['open', 'afterClose'], setup(props, { slots }) {
  watch(() => props.open, async (open, wasOpen) => { if (wasOpen && !open) { await nextTick(); props.afterClose?.() } })
  return () => props.open ? h('div', { role: 'dialog', 'aria-modal': 'true' }, slots.default?.()) : null
} })
const Input = defineComponent({ props: ['value'], emits: ['update:value', 'keydown'], setup(props, { emit, expose }) {
  const input = ref<HTMLInputElement>()
  expose({ focus: () => input.value?.focus() })
  return () => h('input', { ref: input, value: props.value, onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value), onKeydown: (event: KeyboardEvent) => emit('keydown', event) })
} })
const Pass = { render: () => h('div') }
const account = (id: number) => ({ id, username: 'user' + id, role: 'user', displayName: null, avatar: null, deptId: null, deptName: null })
const users = { id: 1, name: '用户管理', path: '/system/users', icon: '' }
const logs = { id: 2, name: '操作日志', path: '/system/logs', icon: '' }
async function setup(menus = [users, logs]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = useAppStore()
  app.userInfo = account(1)
  app.menus = menus
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/home', component: Pass }, { path: '/system/notifications', component: Pass },
    { path: '/system/users', component: Pass, meta: { searchAliases: ['账号'] } },
    { path: '/system/logs', component: Pass, meta: { searchAliases: ['审计'] } },
    { path: '/:pathMatch(.*)*', component: Pass },
  ] })
  await router.push('/home')
  const wrapper = mount(MenuSearch, { attachTo: document.body, global: { plugins: [pinia, router], stubs: { AModal: Modal, AInput: Input } } })
  await wrapper.find('button[aria-label="搜索菜单"]').trigger('click')
  await flushPromises()
  return { app, router, wrapper }
}
beforeEach(() => { sessionStorage.clear() })

describe('授权菜单搜索', () => {
  it('名称、别名可匹配，只搜索实际授权菜单及默认可访问入口', async () => {
    const { wrapper } = await setup([users])
    await wrapper.find('input').setValue('账号')
    expect(wrapper.findAll('[role="option"]').map(item => item.text())).toEqual(['用户管理用户管理'])
    await wrapper.find('input').setValue('审计')
    expect(wrapper.text()).toContain('没有匹配的可访问页面')
    expect(wrapper.text()).not.toContain('操作日志')
    wrapper.unmount()
  })
  it('方向键和 Enter 导航，输入法确认不触发跳转，Ctrl+K 可打开并聚焦', async () => {
    const { wrapper, router } = await setup()
    await wrapper.find('input').trigger('keydown', { key: 'Enter', isComposing: true })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/home')
    await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/system/logs')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.find('input').element)
    wrapper.unmount()
  })
  it('最近访问按账号隔离，授权移除后即使存在历史也不再展示', async () => {
    const { wrapper, app } = await setup()
    await wrapper.find('input').setValue('审计')
    await wrapper.find('[role="option"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(sessionStorage.getItem('starter-menu-search:1')!)).toEqual(['/system/logs'])
    app.userInfo = account(2)
    await flushPromises()
    await wrapper.find('button[aria-label="搜索菜单"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')[0]!.text()).toContain('用户管理')
    app.userInfo = account(1)
    await flushPromises()
    app.menus = [users]
    await wrapper.find('button[aria-label="搜索菜单"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]').some(option => option.text().includes('操作日志'))).toBe(false)
    wrapper.unmount()
  })
  it('关闭后通过 Modal 回调把焦点恢复到菜单入口', async () => {
    const { wrapper } = await setup()
    expect(document.activeElement).toBe(wrapper.find('input').element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.find('button[aria-label="搜索菜单"]').element)
    wrapper.unmount()
  })
});
