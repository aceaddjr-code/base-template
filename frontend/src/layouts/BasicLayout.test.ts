import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import BasicLayout from './BasicLayout.vue'
import { getNotifications, getUnreadCount } from '@/api/notifications'

vi.mock('@/api/notifications', () => ({ getNotifications: vi.fn(), getUnreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), NOTIFICATIONS_CHANGED: 'notifications-changed' }))
vi.mock('@/components/BrandMark.vue', () => ({ default: { template: '<span />' } }))
vi.mock('@/api/notification-stream', () => ({ connectNotificationStream: () => ({ close: () => {} }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/home', meta: { title: '首页' } }), useRouter: () => ({ push: vi.fn() }) }))
const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.overlay?.()]) } })
const Dropdown = defineComponent({ emits: ['openChange'], setup(_, { slots, emit }) { return () => h('div', [h('button', { class: 'open-dropdown', onClick: () => emit('openChange', true) }, '打开'), slots.default?.(), slots.overlay?.()]) } })
const Empty = defineComponent({ props: ['description'], setup(props) { return () => h('div', props.description) } })
const Button = defineComponent({ setup(_, { slots }) { return () => h('button', slots.default?.()) } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getUnreadCount).mockResolvedValue({ count: 0 })
})

it('通知面板请求失败时显示重试，成功后显示空状态', async () => {
  vi.mocked(getNotifications).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ list: [], total: 0, page: 1, pageSize: 8 })
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(BasicLayout, { global: { plugins: [pinia], stubs: {
    ALayout: Pass, ALayoutSider: Pass, ALayoutHeader: Pass, ALayoutContent: Pass, AMenu: Pass,
    AMenuItem: Pass, ASubMenu: Pass, ABreadcrumb: Pass, ABreadcrumbItem: Pass, ATooltip: Pass,
    ADropdown: Dropdown, AEmpty: Empty, AButton: Button, ABadge: Pass, ATag: Pass, AAvatar: Pass,
    RouterLink: Pass, RouterView: true, MenuSearch: true, ProfileDrawer: true, BrandMark: true,
  } } })
  await wrapper.findAll('.open-dropdown')[0]!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('通知加载失败')
  expect(wrapper.text()).not.toContain('暂无通知')
  await wrapper.findAll('button').find(button => button.text() === '重试')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('暂无通知')
  expect(getNotifications).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})
