import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import Announcements from './index.vue'
import { getPublishedAnnouncements } from '@/api/announcement'

vi.mock('@/api/announcement', () => ({ getPublishedAnnouncements: vi.fn() }))
const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.action?.()]) } })
const Empty = defineComponent({ props: ['description'], setup(props) { return () => h('div', props.description) } })
const Button = defineComponent({ setup(_, { slots }) { return () => h('button', slots.default?.()) } })

beforeEach(() => vi.resetAllMocks())

it('公告加载失败时提供重试，不显示无公告空态', async () => {
  vi.mocked(getPublishedAnnouncements).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ list: [], total: 0, page: 1, pageSize: 15 })
  const wrapper = mount(Announcements, { global: { stubs: { Page: Pass, ASpin: Pass, AAlert: Pass, AEmpty: Empty, AButton: Button, APagination: true, AnnouncementDetailModal: true } } })
  await flushPromises()
  expect(wrapper.text()).not.toContain('还没有已发布的公告')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(getPublishedAnnouncements).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('还没有已发布的公告')
  wrapper.unmount()
})
