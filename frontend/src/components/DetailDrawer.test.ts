import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import DetailDrawer, { type DetailField } from './DetailDrawer.vue'
import { Modal } from 'ant-design-vue'
import { printHtml } from '@/utils/print-document'

vi.mock('@/utils/print-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/print-document')>()
  return { ...actual, printHtml: vi.fn() }
})

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), warning: vi.fn() }, Modal: { confirm: vi.fn(options => { options.onOk(); return { destroy: vi.fn() } }) } }))
const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } })
const Drawer = defineComponent({ props: ['maskClosable', 'closable', 'keyboard'], setup(_, { slots }) { return () => h('aside', [h('header', slots.extra?.()), slots.default?.()]) } })
const Item = defineComponent({ props: ['label'], setup(props, { slots }) { return () => h('div', { 'data-field': props.label }, [h('label', props.label), slots.default?.()]) } })
const Input = defineComponent({ props: ['value', 'disabled'], emits: ['update:value'], setup(props, { emit, attrs }) { return () => h('input', { ...attrs, value: props.value ?? '', disabled: props.disabled, onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value) }) } })
const Button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup(props, { emit, slots }) { return () => h('button', { disabled: props.disabled || props.loading, onClick: () => emit('click') }, slots.default?.()) } })
const fields: DetailField[] = [
  { label: '标题', dataIndex: 'title', editable: true, required: true },
  { label: '说明', dataIndex: 'description', editable: true, inputType: 'textarea', span: 2 },
]
function setup(saveHandler = vi.fn().mockResolvedValue(undefined), reloadHandler = vi.fn().mockResolvedValue(undefined), extraProps: Record<string, unknown> = {}) {
  const record = { id: 1, title: '服务端标题', description: '第一行\n第二行' }
  const wrapper = mount(DetailDrawer, { attachTo: document.body, props: { open: true, record, fields, editable: true, saveHandler, reloadHandler, ...extraProps }, global: {
    directives: { access: {} }, stubs: { ADrawer: Drawer, ASpin: Pass, ACard: Pass, ATabs: Pass, ATabPane: Pass, ADescriptions: Pass, ADescriptionsItem: Item, ATooltip: Pass, ATag: Pass, AButton: Button, AInput: Input, ATextarea: Input, AInputNumber: true, ADatePicker: true, ASelect: true, ASwitch: true, AMenu: true, ADropdown: true, AEmpty: true },
  } })
  const button = (label: string) => wrapper.findAll('button').find(element => element.text().trim() === label)!
  return { wrapper, record, saveHandler, reloadHandler, button }
}

describe('详情抽屉原地编辑', () => {
  it('空值输入后又清空，与原始空值等价时取消不误报未保存', async () => {
    const { wrapper, button, record, reloadHandler } = setup()
    await wrapper.setProps({ record: { ...record, description: null } })
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="说明"]').setValue('临时输入')
    await wrapper.get('input[aria-label="说明"]').setValue('')
    vi.mocked(Modal.confirm).mockClear()
    await button('取消').trigger('click'); await flushPromises()
    expect(Modal.confirm).not.toHaveBeenCalled()
    expect(reloadHandler).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('首错在字段旁及摘要同时显示，并聚焦输入；服务端路径映射后保留草稿', async () => {
    const save = vi.fn().mockRejectedValue({ requestId: 'edit-123', response: { data: { fieldErrors: [{ path: 'title', code: 'business', message: '该标题不可使用' }] } } })
    const { wrapper, button } = setup(save)
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="标题"]').setValue(' ')
    await button('保存').trigger('click'); await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toContain('请填写标题')
    expect(wrapper.get('input[aria-label="标题"]').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('input[aria-label="标题"]').element)
    await wrapper.get('input[aria-label="标题"]').setValue('服务器拒绝的标题')
    await button('保存').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('该标题不可使用')
    expect(wrapper.text()).toContain('edit-123')
    expect(wrapper.get('input[aria-label="标题"]').element).toHaveProperty('value', '服务器拒绝的标题')
    wrapper.unmount()
  })
  it('关闭有修改的抽屉需确认，继续编辑时保留草稿', async () => {
    let options: any
    vi.mocked(Modal.confirm).mockImplementationOnce(value => { options = value; return { destroy: vi.fn(), update: vi.fn() } })
    const { wrapper, button } = setup()
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="标题"]').setValue('草稿')
    wrapper.findComponent(Drawer).vm.$emit('close')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    options.onCancel(); await flushPromises()
    expect(wrapper.get('input[aria-label="标题"]').element).toHaveProperty('value', '草稿')
    wrapper.findComponent(Drawer).vm.$emit('close')
    await flushPromises()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
  it('查看与编辑保留同一字段位置，取消丢弃独立草稿并重新加载', async () => {
    const { wrapper, record, button, reloadHandler, saveHandler } = setup()
    const positions = () => wrapper.findAll('[data-field]').map(element => element.attributes('data-field'))
    const original = positions()
    await button('编辑').trigger('click')
    expect(wrapper.text()).toContain('编辑中')
    expect(positions()).toEqual(original)
    await wrapper.get('input[aria-label="标题"]').setValue('未保存草稿')
    expect(record.title).toBe('服务端标题')
    await button('取消').trigger('click')
    await flushPromises()
    expect(reloadHandler).toHaveBeenCalledOnce()
    expect(saveHandler).not.toHaveBeenCalled()
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('服务端标题')
    wrapper.unmount()
  })

  it('保存失败保留编辑态和草稿，重试成功回到查看态且不关闭抽屉', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('服务端拒绝')).mockResolvedValueOnce(undefined)
    const { wrapper, button } = setup(save)
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="标题"]').setValue('修正标题')
    await button('保存').trigger('click')
    await flushPromises()
    expect(wrapper.get('input[aria-label="标题"]').element).toHaveProperty('value', '修正标题')
    expect(wrapper.text()).toContain('编辑中')
    await button('保存').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({ title: '修正标题', description: '第一行\n第二行' })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toBeUndefined()
    wrapper.unmount()
  })

  it('保存中阻止重复请求和关闭，切换记录后迟到结果不影响新详情', async () => {
    let complete!: () => void
    const save = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    const { wrapper, button } = setup(save)
    await button('编辑').trigger('click')
    await button('保存').trigger('click')
    await button('保存').trigger('click')
    expect(save).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(Drawer).props()).toMatchObject({ maskClosable: false, keyboard: false, closable: false })
    await wrapper.setProps({ record: { id: 2, title: '另一条', description: null } })
    complete()
    await flushPromises()
    expect(wrapper.text()).toContain('另一条')
    expect(wrapper.emitted('saved')).toBeUndefined()
    wrapper.unmount()
  })

  it('保存后同一记录的详情对象替换仍通知列表刷新', async () => {
    let complete!: () => void
    const save = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
    const { wrapper, button } = setup(save)
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="标题"]').setValue('已保存标题')
    await button('保存').trigger('click')
    await wrapper.setProps({ record: { id: 1, title: '已保存标题', description: '服务端完整值' } })
    complete()
    await flushPromises()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.text()).toContain('已保存标题')
    wrapper.unmount()
  })

  it('关闭重开重置编辑态，空白必填值不能提交，加载中不能进入编辑', async () => {
    const { wrapper, button, saveHandler } = setup()
    await button('编辑').trigger('click')
    await wrapper.get('input[aria-label="标题"]').setValue('   ')
    await button('保存').trigger('click')
    expect(saveHandler).not.toHaveBeenCalled()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, loading: true })
    await wrapper.vm.startEdit()
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.setProps({ loading: false })
    await button('编辑').trigger('click')
    expect(wrapper.get('input[aria-label="标题"]').element).toHaveProperty('value', '服务端标题')
    wrapper.unmount()
  })

  it('未开启 printable 时不显示打印按钮', () => {
    const { wrapper, button } = setup()
    expect(button('打印')).toBeUndefined()
    wrapper.unmount()
  })

  it('开启 printable 后查看态可打印当前记录，编辑态无打印入口', async () => {
    vi.mocked(printHtml).mockClear()
    const { wrapper, button } = setup(undefined, undefined, { printable: true, systemName: '测试系统' })
    await button('打印').trigger('click')
    await flushPromises()
    expect(printHtml).toHaveBeenCalledTimes(1)
    const html = vi.mocked(printHtml).mock.calls[0]![0] as string
    expect(html).toContain('测试系统')
    expect(html).toContain('单据详情')
    expect(html).toContain('服务端标题')
    expect(html).toContain('第一行')
    expect(html).toContain('编号：1')
    expect(html).toContain('打印范围：当前查看的单据详情。')
    // 编辑态不提供打印
    await button('编辑').trigger('click')
    expect(button('打印')).toBeUndefined()
    wrapper.unmount()
  })
});
