import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './index.vue'
import { forgetPassword, readRemembered, rememberCredentials } from './remember-credential'
import { useAppStore } from '@/stores/app'

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), error: vi.fn() } }))

const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } })
/** 输入框桩：只保留 v-model:value 往返，测试按 DOM 的值断言回填与清空结果 */
const Field = defineComponent({
  props: ['value'],
  emits: ['update:value'],
  setup(props, { emit }) {
    return () => h('input', { value: props.value ?? '', onInput: (e: Event) => emit('update:value', (e.target as HTMLInputElement).value) })
  },
})
const Check = defineComponent({
  props: ['checked'],
  emits: ['update:checked'],
  setup(props, { slots }) {
    return () => h('label', [h('input', { type: 'checkbox', checked: !!props.checked }), slots.default?.()])
  },
})
const Form = defineComponent({ emits: ['finish'], setup(_, { slots }) { return () => h('form', slots.default?.()) } })

const stubs = { AForm: Form, AFormItem: Pass, AInput: Field, AInputPassword: Field, ACheckbox: Check, AButton: Pass, BrandMark: Pass, WarningOutlined: Pass }

async function setup(query = '') {
  // 页面 setup 会读「记住密码」记录并调用 store.signIn，挂载前需激活 Pinia
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useAppStore()
  store.signIn = vi.fn(async () => undefined)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: LoginPage },
      { path: '/change-password', component: Pass },
      { path: '/home', component: Pass },
      { path: '/:pathMatch(.*)*', component: Pass },
    ],
  })
  await router.push(`/login${query}`)
  await router.isReady()
  const wrapper = mount(LoginPage, { global: { plugins: [pinia, router], stubs } })
  return { wrapper, store, router }
}
type Wrapper = Awaited<ReturnType<typeof setup>>['wrapper']
/** 页面上的输入框依次为用户名、密码、记住密码勾选框 */
const boxes = (wrapper: Wrapper) => wrapper.findAll('input')
const values = (wrapper: Wrapper) => boxes(wrapper).slice(0, 2).map((box) => (box.element as HTMLInputElement).value)
const typeInto = async (wrapper: Wrapper, index: number, text: string) => boxes(wrapper)[index].setValue(text)
const checkbox = (wrapper: Wrapper) => wrapper.findComponent(Check)
async function setRemember(wrapper: Wrapper, checked: boolean) {
  checkbox(wrapper).vm.$emit('update:checked', checked)
  await nextTick()
}
async function submit(wrapper: Wrapper) {
  wrapper.findComponent(Form).vm.$emit('finish')
  await flushPromises()
}

describe('登录页记住密码', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetAllMocks()
  })

  it('首次进入不预填、不勾选', async () => {
    const { wrapper } = await setup()
    expect(values(wrapper)).toEqual(['', ''])
    expect(checkbox(wrapper).props('checked')).toBe(false)
    expect(wrapper.text()).toContain('记住密码')
    wrapper.unmount()
  })

  it('上次记住过就自动填好用户名和密码并勾上', async () => {
    rememberCredentials('admin', 'Sup3r-Secret')
    const { wrapper } = await setup()
    expect(values(wrapper)).toEqual(['admin', 'Sup3r-Secret'])
    expect(checkbox(wrapper).props('checked')).toBe(true)
    wrapper.unmount()
  })

  it('只记住过用户名时填空密码并保持不勾选', async () => {
    rememberCredentials('admin', 'Sup3r-Secret')
    forgetPassword('admin')
    const { wrapper } = await setup()
    expect(values(wrapper)).toEqual(['admin', ''])
    expect(checkbox(wrapper).props('checked')).toBe(false)
    wrapper.unmount()
  })

  it('勾选着登录成功才把密码留到本机，输入框仍然清空', async () => {
    const { wrapper, store } = await setup()
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'Sup3r-Secret')
    await setRemember(wrapper, true)
    await submit(wrapper)
    expect(store.signIn).toHaveBeenCalledWith({ loginid: 'admin', password: 'Sup3r-Secret' })
    expect(readRemembered()).toEqual({ username: 'admin', password: 'Sup3r-Secret' })
    expect(values(wrapper)).toEqual(['admin', ''])
    wrapper.unmount()
  })

  it('没勾选就不写密码，并清掉本机旧密码', async () => {
    rememberCredentials('admin', 'old-pass')
    const { wrapper } = await setup()
    expect(checkbox(wrapper).props('checked')).toBe(true)
    await setRemember(wrapper, false)
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
    await typeInto(wrapper, 1, 'new-pass')
    await submit(wrapper)
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
    wrapper.unmount()
  })

  it('登录失败不把错的密码记成上次的密码', async () => {
    const { wrapper, store } = await setup()
    vi.mocked(store.signIn).mockRejectedValueOnce(new Error('账号或密码错误'))
    await setRemember(wrapper, true)
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'wrong-pass')
    await submit(wrapper)
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
    expect(wrapper.text()).toContain('账号或密码错误')
    wrapper.unmount()
  })

  it('待改密的临时密码不记住，本机旧密码一并作废', async () => {
    rememberCredentials('admin', 'temp-pass')
    const { wrapper, store, router } = await setup()
    store.mustChangePassword = true
    await submit(wrapper)
    expect(router.currentRoute.value.path).toBe('/change-password')
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
    wrapper.unmount()
  })

  it('改密完成回登录页时本机旧密码作废', async () => {
    rememberCredentials('admin', 'old-pass')
    const { wrapper } = await setup('?reason=password-changed')
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
    expect(values(wrapper)).toEqual(['admin', ''])
    expect(checkbox(wrapper).props('checked')).toBe(false)
    wrapper.unmount()
  })
})
