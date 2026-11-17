import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './index.vue'
import { readRememberedUsername, rememberUsername } from './remember-username'
import { useAppStore } from '@/stores/app'

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/BrandMark.vue', () => ({ default: { template: '<span />' } }))

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
  props: ['checked', 'disabled'],
  emits: ['update:checked'],
  setup(props, { slots }) {
    return () => h('label', [h('input', { type: 'checkbox', checked: !!props.checked }), slots.default?.()])
  },
})
const Form = defineComponent({ emits: ['finish'], setup(_, { slots }) { return () => h('form', slots.default?.()) } })

const stubs = { AForm: Form, AFormItem: Pass, AInput: Field, AInputPassword: Field, ACheckbox: Check, AButton: Pass, BrandMark: Pass, WarningOutlined: Pass }

async function setup(query = '') {
  // 页面 setup 会读「记住用户名」记录并调用 store.signIn，挂载前需激活 Pinia
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
/** 页面上的输入框依次为用户名、密码、记住用户名勾选框 */
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

describe('登录页记住用户名', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetAllMocks()
  })

  it('首次进入不预填、不勾选，保留浏览器自动填充标记', async () => {
    const { wrapper } = await setup()
    expect(values(wrapper)).toEqual(['', ''])
    expect(checkbox(wrapper).props('checked')).toBe(false)
    expect(wrapper.text()).toContain('记住用户名')
    expect(boxes(wrapper)[0].attributes('autocomplete')).toBe('username')
    expect(boxes(wrapper)[1].attributes('autocomplete')).toBe('current-password')
    wrapper.unmount()
  })

  it('记住用户名后重新进入，应用只回填用户名', async () => {
    rememberUsername('admin')
    const { wrapper } = await setup()
    expect(values(wrapper)).toEqual(['admin', ''])
    expect(checkbox(wrapper).props('checked')).toBe(true)
    wrapper.unmount()
  })

  it('勾选后登录成功，只保存用户名并清空密码框', async () => {
    const { wrapper, store } = await setup()
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'test-password')
    await setRemember(wrapper, true)
    await submit(wrapper)
    expect(store.signIn).toHaveBeenCalledWith({ loginid: 'admin', password: 'test-password' })
    expect(JSON.parse(localStorage.getItem('starter-login-username')!)).toEqual({ v: 1, username: 'admin' })
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
    expect(values(wrapper)).toEqual(['admin', ''])
    wrapper.unmount()
  })

  it('未勾选登录成功，不保存用户名或密码', async () => {
    const { wrapper } = await setup()
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'test-password')
    await submit(wrapper)
    expect(localStorage.length).toBe(0)
    wrapper.unmount()
  })

  it('取消勾选立即清除用户名，重新进入不再回填', async () => {
    rememberUsername('admin')
    const { wrapper } = await setup()
    await setRemember(wrapper, false)
    expect(readRememberedUsername()).toBe('')
    wrapper.unmount()
    const next = await setup()
    expect(values(next.wrapper)).toEqual(['', ''])
    next.wrapper.unmount()
  })

  it('登录失败保留输入并反馈错误，不保存本次用户名或密码', async () => {
    const { wrapper, store } = await setup()
    vi.mocked(store.signIn).mockRejectedValueOnce(new Error('账号或密码错误'))
    await setRemember(wrapper, true)
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'wrong-pass')
    await submit(wrapper)
    expect(localStorage.length).toBe(0)
    expect(values(wrapper)).toEqual(['admin', 'wrong-pass'])
    expect(wrapper.text()).toContain('账号或密码错误')
    wrapper.unmount()
  })

  it('待改密成功登录只按勾选记用户名，清空临时密码并跳转', async () => {
    const { wrapper, store, router } = await setup()
    store.mustChangePassword = true
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'temporary-password')
    await setRemember(wrapper, true)
    await submit(wrapper)
    expect(router.currentRoute.value.path).toBe('/change-password')
    expect(readRememberedUsername()).toBe('admin')
    expect(values(wrapper)[1]).toBe('')
    wrapper.unmount()
  })

  it('升级时删除旧凭据，改密后回登录页只回填用户名', async () => {
    localStorage.setItem('starter-login-remember', JSON.stringify({ v: 1, u: 'admin', r: 1, p: 'old-obfuscated-password' }))
    const { wrapper } = await setup('?reason=password-changed')
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
    expect(values(wrapper)).toEqual(['admin', ''])
    expect(wrapper.text()).toContain('密码已修改')
    wrapper.unmount()
  })

  it('登录请求期间显示加载状态并禁用记住用户名开关', async () => {
    const { wrapper, store } = await setup()
    let finish!: () => void
    vi.mocked(store.signIn).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await typeInto(wrapper, 0, 'admin')
    await typeInto(wrapper, 1, 'test-password')
    wrapper.findComponent(Form).vm.$emit('finish')
    await nextTick()
    expect(checkbox(wrapper).props('disabled')).toBe(true)
    expect(boxes(wrapper)[0].attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(checkbox(wrapper).props('disabled')).toBe(false)
    wrapper.unmount()
  })
})
