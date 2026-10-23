import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUnsavedChanges } from './useUnsavedChanges'

async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/next', component: { render: () => null } }] })
  await router.push('/')
  const active = ref(true), dirty = ref(false), saving = ref(false)
  let guard!: ReturnType<typeof useUnsavedChanges>
  const dialogs: Parameters<typeof Modal.confirm>[0][] = []
  const destroy = vi.fn()
  vi.spyOn(Modal, 'confirm').mockImplementation(options => { dialogs.push(options); return { destroy, update: vi.fn() } })
  const wrapper = mount(defineComponent({ setup() {
    guard = useUnsavedChanges({ active: () => active.value, dirty: () => dirty.value, saving: () => saving.value })
    return () => h('input')
  } }), { attachTo: document.body, global: { plugins: [router] } })
  return { router, active, dirty, saving, guard, dialogs, wrapper, destroy }
}
afterEach(() => vi.restoreAllMocks())
describe('未保存输入保护', () => {
  it('无修改可直接关闭；有修改取消后保留，并恢复原焦点', async () => {
    const value = await setup()
    const close = vi.fn()
    await value.guard.attempt(close)
    expect(close).toHaveBeenCalledOnce()
    value.dirty.value = true
    value.wrapper.find('input').element.focus()
    const closing = value.guard.attempt(close)
    expect(value.dialogs).toHaveLength(1)
    value.dialogs[0]!.onCancel?.()
    value.dialogs[0]!.afterClose?.()
    await closing
    expect(close).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(value.wrapper.find('input').element)
    value.wrapper.unmount()
  })
  it('导航与关闭共享确认；选择继续编辑停留原路由，放弃后才离开', async () => {
    const value = await setup()
    value.dirty.value = true
    const navigate = value.router.push('/next')
    await flushPromises()
    value.dialogs[0]!.onCancel?.()
    await navigate
    expect(value.router.currentRoute.value.path).toBe('/')
    const again = value.router.push('/next')
    await flushPromises()
    value.dialogs[1]!.onOk?.()
    await again
    expect(value.router.currentRoute.value.path).toBe('/next')
    value.wrapper.unmount()
  })
  it('保存期间不关闭或导航，刷新时触发浏览器保护，卸载后清理', async () => {
    const value = await setup()
    value.saving.value = true
    const close = vi.fn()
    await value.guard.attempt(close)
    await value.router.push('/next')
    expect(close).not.toHaveBeenCalled()
    expect(value.router.currentRoute.value.path).toBe('/')
    expect(value.dialogs).toHaveLength(0)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    value.wrapper.unmount()
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
  it('重复离开请求只开一个确认框，卸载安全取消待决操作', async () => {
    const value = await setup()
    value.dirty.value = true
    const close = vi.fn()
    const first = value.guard.attempt(close), second = value.guard.attempt(close)
    expect(value.dialogs).toHaveLength(1)
    value.wrapper.unmount()
    await Promise.all([first, second])
    expect(value.destroy).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })
})
