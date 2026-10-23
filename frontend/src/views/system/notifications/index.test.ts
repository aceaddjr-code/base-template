import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Notifications from './index.vue'
import { getNotifications, getUnreadCount, markAllRead } from '@/api/notifications'
import { useAppStore } from '@/stores/app'

vi.mock('@/api/notifications', () => ({ getNotifications: vi.fn(), getUnreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() }))
vi.mock('ant-design-vue', () => ({ message: { success: vi.fn() } }))
vi.mock('@/composables/useDict', () => ({ useDict: () => ({ labelOf: (value: string) => value, colorOf: () => undefined }) }))
const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } })
const Radio = defineComponent({ props: ['value'], emits: ['update:value', 'change'], setup(_, { slots }) { return () => h('div', slots.default?.()) } })
const Table = defineComponent({ props: ['dataSource', 'loading'], setup(_, { slots }) { return () => h('div', slots.emptyText?.()) } })
const Footer = defineComponent({ props: ['pagination', 'totalText'], emits: ['change'], setup() { return () => h('div') } })
const Button = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { onClick: () => emit('click') }, slots.default?.()) } })
function setup() {
  // 页面 setup 经 useAppStore / 账号隔离 key 读取当前账号,挂载前需激活 Pinia
  const pinia = createPinia()
  setActivePinia(pinia)
  useAppStore().userInfo = { id: 1, username: 'admin', role: 'admin', displayName: null, avatar: null, deptId: null, deptName: null }
  return mount(Notifications, { global: { plugins: [pinia], stubs: { ACard: Pass, ARadioGroup: Radio, ARadioButton: Pass,
    ATable: Table, ListFooter: Footer, AButton: Button, AAlert: Pass, AEmpty: Pass } } })
}
const page = (total = 23) => ({ list: [], total, page: 1, pageSize: 10 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getNotifications).mockResolvedValue(page())
  vi.mocked(getUnreadCount).mockResolvedValue({ count: 23 })
})

describe('通知页筛选与结果状态', () => {
  it('后端 total 直接用于分页，切换筛选回第一页且下推 readStatus', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(wrapper.findComponent(Footer).props('pagination').total).toBe(23)
    wrapper.findComponent(Footer).vm.$emit('change', 3, 10)
    await flushPromises()
    expect(getNotifications).toHaveBeenLastCalledWith({ page: 3, pageSize: 10, readStatus: 'unread' }, expect.any(AbortSignal))
    const radio = wrapper.findComponent(Radio)
    radio.vm.$emit('update:value', 'all')
    await wrapper.vm.$nextTick()
    radio.vm.$emit('change')
    await flushPromises()
    expect(getNotifications).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, readStatus: 'all' }, expect.any(AbortSignal))
    wrapper.unmount()
  })

  it('失败明确呈现数量未知；全部已读后重新读取服务端结果', async () => {
    vi.mocked(getNotifications).mockRejectedValueOnce(new Error('offline'))
    const wrapper = setup()
    await flushPromises()
    expect(wrapper.text()).toContain('通知未加载')
    expect(wrapper.findComponent(Footer).props('totalText')(0)).toBe('数量暂不可用')
    vi.mocked(getNotifications).mockResolvedValue(page(0))
    vi.mocked(getUnreadCount).mockResolvedValue({ count: 0 })
    await wrapper.findAll('button').find(button => button.text() === '全部已读')!.trigger('click')
    await flushPromises()
    expect(markAllRead).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(Footer).props('pagination').total).toBe(0)
    expect(wrapper.findComponent(Footer).props('totalText')(0)).toBe('共 0 条')
    wrapper.unmount()
  })

  it('迟到结果不能覆盖新查询或提前结束新查询加载', async () => {
    const old = deferred<ReturnType<typeof page>>()
    vi.mocked(getNotifications).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(25))
    const wrapper = setup()
    const radio = wrapper.findComponent(Radio)
    radio.vm.$emit('update:value', 'all')
    await wrapper.vm.$nextTick()
    radio.vm.$emit('change')
    await flushPromises()
    old.resolve(page(23))
    await flushPromises()
    expect(wrapper.findComponent(Footer).props('pagination').total).toBe(25)
    expect(wrapper.findComponent(Table).props('loading')).toBe(false)
    wrapper.unmount()
  })
});
