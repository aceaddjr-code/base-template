import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import ExampleDetailDrawer from './ExampleDetailDrawer.vue'
import { getExample, updateExample } from '@/api/example'

vi.mock('@/api/example', () => ({ getExample: vi.fn(), updateExample: vi.fn() }))
const startEdit = vi.fn()
const exitEditToView = vi.fn()
const Detail = defineComponent({
  props: ['record', 'loading', 'saveHandler', 'reloadHandler'],
  setup(props, { expose, slots }) { expose({ startEdit, exitEditToView }); return () => h('div', [String(props.record?.title ?? ''), slots.before?.()]) },
})
const row = (id: number, title = `记录${id}`) => ({ id, title, status: 'pending' as const, description: '完整服务端说明', ownerId: 1, version: 1, createdAt: '', updatedAt: '' })
const Alert = defineComponent({ props: ['message', 'description', 'type', 'showIcon'], setup(props) { return () => h('div', { class: 'alert-stub' }, [String(props.message ?? ''), String(props.description ?? '')]) } })
const Btn = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { type: 'button', onClick: () => emit('click') }, slots.default?.()) } })
const drawerStubs = { DetailDrawer: Detail, AAlert: Alert, AButton: Btn }
describe('示例详情数据生命周期', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('保存提交加载时的版本号（F06）', async () => {
    vi.mocked(getExample).mockResolvedValue({ ...row(1), version: 6 })
    vi.mocked(updateExample).mockResolvedValue({ ...row(1), version: 7 })
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: drawerStubs } })
    await flushPromises()
    await wrapper.findComponent(Detail).props('saveHandler')({ title: '新标题' })
    expect(updateExample).toHaveBeenCalledWith(1, { title: '新标题', version: 6 }, { errorFeedback: 'form' })
    wrapper.unmount()
  })

  it('保存遇到 409 冲突时保留草稿并给出继续编辑/载入最新出口', async () => {
    vi.mocked(getExample).mockResolvedValue(row(1))
    vi.mocked(updateExample).mockRejectedValueOnce(Object.assign(new Error('记录已被他人修改或已删除，请刷新后查看最新内容'), { response: { status: 409 } }))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: drawerStubs } })
    await flushPromises()
    await expect(wrapper.findComponent(Detail).props('saveHandler')({ title: '我的草稿' })).rejects.toMatchObject({ response: { status: 409 } })
    await flushPromises()
    expect(wrapper.text()).toContain('记录已被他人修改')
    expect(wrapper.text()).toContain('继续编辑')
    const load = wrapper.findAll('button').find((button) => button.text().includes('载入最新内容'))
    await load!.trigger('click')
    await flushPromises()
    expect(exitEditToView).toHaveBeenCalledTimes(1)
    expect(getExample).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('载入最新内容')
    wrapper.unmount()
  })

  it('列表编辑等待完整详情后才进入编辑，保存后重新读取而非使用列表快照', async () => {
    vi.mocked(getExample).mockResolvedValueOnce(row(1)).mockResolvedValueOnce(row(1, '服务端最新标题'))
    vi.mocked(updateExample).mockResolvedValue(row(1, '更新接口返回'))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1, startInEdit: true }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    expect(startEdit).not.toHaveBeenCalled()
    await flushPromises()
    expect(startEdit).toHaveBeenCalledOnce()
    await wrapper.findComponent(Detail).props('saveHandler')({ title: '保存标题' })
    expect(updateExample).toHaveBeenCalledWith(1, { title: '保存标题', version: 1 }, { errorFeedback: 'form' })
    expect(getExample).toHaveBeenCalledTimes(2)
    expect(getExample).toHaveBeenLastCalledWith(1, { errorFeedback: 'form' })
    expect(wrapper.text()).toContain('服务端最新标题')
    wrapper.unmount()
  })
  it('写入成功而回读失败时明确提示核对，不自动再次提交写入', async () => {
    vi.mocked(getExample).mockResolvedValueOnce(row(1)).mockRejectedValueOnce({ requestId: 'reread-123', response: { status: 500, data: { message: '服务器内部错误' } } })
    vi.mocked(updateExample).mockResolvedValue(row(1))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    await flushPromises()
    await expect(wrapper.findComponent(Detail).props('saveHandler')({ title: '本次保存' })).rejects.toMatchObject({ requestId: 'reread-123', feedbackMessage: expect.stringContaining('保存已提交') })
    expect(updateExample).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(Detail).props('record').title).toBe('记录1')
    wrapper.unmount()
  })

  it('快速切换和关闭后，旧详情响应不能覆盖新记录', async () => {
    let resolveOld!: (value: any) => void
    vi.mocked(getExample).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce(row(2))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    await wrapper.setProps({ recordId: 2 })
    await flushPromises()
    resolveOld(row(1))
    await flushPromises()
    expect(wrapper.text()).toContain('记录2')
    expect(wrapper.text()).not.toContain('记录1')
    await wrapper.setProps({ open: false })
    expect(wrapper.findComponent(Detail).props('record')).toBeNull()
    wrapper.unmount()
  })
});
