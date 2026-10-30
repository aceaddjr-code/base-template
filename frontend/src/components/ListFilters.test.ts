import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from 'ant-design-vue'
import ListFilters from './ListFilters.vue'

describe('已应用筛选标签', () => {
  const props = { tags: [{ key: 'status', label: '状态：进行中' }], dirty: false, failed: false }
  it('键盘可达的移除按钮明确命名；干净草稿直接移除', async () => {
    const wrapper = mount(ListFilters, { props, global: { stubs: { ATag: { template: '<span><slot /></span>' } } } })
    await wrapper.find('button[aria-label="移除状态：进行中"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['status']])
    wrapper.unmount()
  })
  it('未查询输入存在时，确认后才替换，取消不改变草稿', async () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockReturnValue({ destroy: vi.fn(), update: vi.fn() })
    const wrapper = mount(ListFilters, { props: { ...props, dirty: true }, global: { stubs: { ATag: { template: '<span><slot /></span>' } } } })
    await wrapper.find('button[aria-label="移除状态：进行中"]').trigger('click')
    expect(wrapper.emitted('remove')).toBeUndefined()
    const options = confirm.mock.calls[0]![0]
    expect(options.cancelText).toBe('保留输入')
    options.onOk?.()
    expect(wrapper.emitted('remove')).toEqual([['status']])
    wrapper.unmount(); confirm.mockRestore()
  })
})
