import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PageToolbar from './PageToolbar.vue'

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), warning: vi.fn() } }))

const PassThrough = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.overlay?.()]) } })
const Menu = defineComponent({
  emits: ['click'],
  setup(_, { emit, slots }) {
    return () => h('div', [slots.default?.(), h('button', { class: 'menu-import', onClick: () => emit('click', { key: 'import' }) })])
  },
})
const Modal = defineComponent({
  props: { open: Boolean, okText: String, cancelText: String, okButtonProps: Object, cancelButtonProps: Object },
  emits: ['ok', 'cancel', 'update:open'],
  setup(props, { emit, slots }) {
    return () => h('div', { class: 'modal-stub', 'data-open': String(props.open) }, [
      h('button', { class: 'modal-ok', disabled: !!props.okButtonProps?.disabled, onClick: () => emit('ok') }, props.okText),
      h('button', { class: 'modal-cancel', disabled: !!props.cancelButtonProps?.disabled, onClick: () => emit('cancel') }, props.cancelText),
      slots.default?.(),
    ])
  },
})
const Upload = defineComponent({
  props: { beforeUpload: Function, disabled: Boolean },
  setup(props) {
    return () => h('button', { class: 'pick-file', disabled: props.disabled, onClick: () => props.beforeUpload?.(new File(['x'], 'rows.xlsx')) })
  },
})
const Button = defineComponent({ setup(_, { slots }) { return () => h('button', { type: 'button' }, slots.default?.()) } })

function setup(props: Record<string, any>) {
  return mount(PageToolbar, {
    props: { menuItems: ['import'], showSearch: false, ...props },
    global: {
      directives: { access: {} },
      stubs: { ADropdown: PassThrough, ATooltip: PassThrough, AMenu: Menu, AMenuItem: PassThrough, AModal: Modal, AUpload: Upload, AButton: Button, AInputSearch: true },
    },
  })
}

const openWizard = async (wrapper: ReturnType<typeof setup>) => {
  await wrapper.get('button.menu-import').trigger('click')
  expect(wrapper.get('.modal-stub').attributes('data-open')).toBe('true')
  await wrapper.get('button.pick-file').trigger('click')
}

describe('PageToolbar 导入向导（F30）', () => {
  beforeEach(() => localStorage.clear())

  it('无预检属性时保持直连导入:一次确认即调用处理器并关闭', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    const wrapper = setup({ importHandler: handler })
    await openWizard(wrapper)
    await wrapper.get('button.modal-ok').trigger('click')
    await flushPromises()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.modal-stub').attributes('data-open')).toBe('false')
    wrapper.unmount()
  })

  it('预检模式:先预检展示统计,再确认导入并通知页面刷新', async () => {
    const errors = Array.from({ length: 12 }, (_, i) => ({ row: i + 2, message: '状态必须为 pending、doing 或 done' }))
    const precheck = vi.fn().mockResolvedValue({ total: 12, valid: 0, errors })
    const confirm = vi.fn().mockResolvedValue({ imported: 0, total: 12, errors })
    const wrapper = setup({ importPrecheck: precheck, importConfirm: confirm, importTemplateUrl: 'http://x/template' })
    await openWizard(wrapper)
    expect(wrapper.find('.pt-template-row').exists()).toBe(true)
    await wrapper.get('button.modal-ok').trigger('click')
    await flushPromises()
    expect(precheck).toHaveBeenCalledWith(expect.any(File))
    expect(wrapper.text()).toContain('共 12 行')
    // 超过 10 条错误时提供完整错误文件下载
    expect(wrapper.find('button.pt-err-download').exists()).toBe(true)
    const createObjectURL = vi.fn(() => 'blob:x')
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    await wrapper.get('button.pt-err-download').trigger('click')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    // 确认后展示完整结果,OK 禁用防止重复导入,页面收到 imported 通知
    await wrapper.get('button.modal-ok').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('导入完成')
    expect(wrapper.get('button.modal-ok').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('imported')).toHaveLength(1)
    wrapper.unmount()
  })

  it('确认导入进行中取消被禁用,防止误关弹窗', async () => {
    const precheck = vi.fn().mockResolvedValue({ total: 1, valid: 1, errors: [] })
    const confirm = vi.fn().mockImplementation(() => new Promise(() => {}))
    const wrapper = setup({ importPrecheck: precheck, importConfirm: confirm })
    await openWizard(wrapper)
    await wrapper.get('button.modal-ok').trigger('click')
    await flushPromises()
    await wrapper.get('button.modal-ok').trigger('click')
    await flushPromises()
    expect(wrapper.get('button.modal-cancel').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('取消后迟到的预检响应不写回,重开回到选择文件', async () => {
    let resolvePrecheck!: (value: { total: number; valid: number; errors: [] }) => void
    const precheck = vi.fn().mockImplementation(() => new Promise((resolve) => { resolvePrecheck = resolve }))
    const wrapper = setup({ importPrecheck: precheck, importConfirm: vi.fn() })
    await openWizard(wrapper)
    await wrapper.get('button.modal-ok').trigger('click')
    await wrapper.get('button.modal-cancel').trigger('click')
    resolvePrecheck({ total: 1, valid: 0, errors: [] })
    await flushPromises()
    await wrapper.get('button.menu-import').trigger('click')
    expect(wrapper.find('.pt-preview').exists()).toBe(false)
    expect(wrapper.find('button.pick-file').exists()).toBe(true)
    wrapper.unmount()
  })
})
