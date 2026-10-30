import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import ExampleDetailDrawer from './ExampleDetailDrawer.vue'
import { accessExample, getExample, updateExample } from '@/api/example'

vi.mock('@/api/example', () => ({ accessExample: vi.fn(), getExample: vi.fn(), updateExample: vi.fn(), getExampleHistory: vi.fn() }))
const startEdit = vi.fn()
const exitEditToView = vi.fn()
const printDetail = vi.fn()
const Detail = defineComponent({
  props: ['record', 'loading', 'saveHandler', 'reloadHandler', 'preparePrint'],
  setup(props, { expose, slots }) { expose({ startEdit, exitEditToView, printDetail }); return () => h('div', [String(props.record?.title ?? ''), slots.before?.(), slots.panel?.()]) },
})
const row = (id: number, title = `记录${id}`) => ({ id, title, status: 'pending' as const, description: '完整服务端说明', ownerId: 1, version: 1, createdAt: '', updatedAt: '' })
const Alert = defineComponent({ props: ['message', 'description', 'type', 'showIcon'], setup(props) { return () => h('div', { class: 'alert-stub' }, [String(props.message ?? ''), String(props.description ?? '')]) } })
const Btn = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { type: 'button', onClick: () => emit('click') }, slots.default?.()) } })
const drawerStubs = { DetailDrawer: Detail, AAlert: Alert, AButton: Btn }
describe('示例详情数据生命周期', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(accessExample).mockResolvedValue({ record: row(1), eventId: 1 }) })

  it('保存提交加载时的版本号（F06）', async () => {
    vi.mocked(accessExample).mockResolvedValue({ record: { ...row(1), version: 6 }, eventId: 1 })
    vi.mocked(getExample).mockResolvedValue({ ...row(1), version: 7 })
    vi.mocked(updateExample).mockResolvedValue({ ...row(1), version: 7 })
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: drawerStubs } })
    await flushPromises()
    expect(accessExample).toHaveBeenCalledWith(1, { action: 'view', interactionId: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/) })
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
    expect(getExample).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('载入最新内容')
    wrapper.unmount()
  })

  it('列表编辑等待完整详情后才进入编辑，保存后重新读取而非使用列表快照', async () => {
    vi.mocked(getExample).mockResolvedValueOnce(row(1, '服务端最新标题'))
    vi.mocked(updateExample).mockResolvedValue(row(1, '更新接口返回'))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1, startInEdit: true }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    expect(startEdit).not.toHaveBeenCalled()
    await flushPromises()
    expect(startEdit).toHaveBeenCalledOnce()
    await wrapper.findComponent(Detail).props('saveHandler')({ title: '保存标题' })
    expect(updateExample).toHaveBeenCalledWith(1, { title: '保存标题', version: 1 }, { errorFeedback: 'form' })
    expect(getExample).toHaveBeenCalledTimes(1)
    expect(accessExample).toHaveBeenCalledOnce()
    expect(getExample).toHaveBeenLastCalledWith(1, { errorFeedback: 'form' })
    expect(wrapper.text()).toContain('服务端最新标题')
    wrapper.unmount()
  })
  it('写入成功而回读失败时明确提示核对，不自动再次提交写入', async () => {
    vi.mocked(getExample).mockRejectedValueOnce({ requestId: 'reread-123', response: { status: 500, data: { message: '服务器内部错误' } } })
    vi.mocked(updateExample).mockResolvedValue(row(1))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    await flushPromises()
    await expect(wrapper.findComponent(Detail).props('saveHandler')({ title: '本次保存' })).rejects.toMatchObject({ requestId: 'reread-123', feedbackMessage: expect.stringContaining('保存已提交') })
    expect(updateExample).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(Detail).props('record').title).toBe('记录1')
    vi.mocked(getExample).mockResolvedValue(row(1, '已提交结果'))
    await wrapper.findComponent(Detail).props('saveHandler')({ title: '本次保存' })
    expect(updateExample).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('快速切换和关闭后，旧详情响应不能覆盖新记录', async () => {
    let resolveOld!: (value: any) => void
    vi.mocked(accessExample).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce({ record: row(2), eventId: 2 })
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: { DetailDrawer: Detail } } })
    await wrapper.setProps({ recordId: 2 })
    await flushPromises()
    resolveOld({ record: row(1), eventId: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('记录2')
    expect(wrapper.text()).not.toContain('记录1')
    await wrapper.setProps({ open: false })
    expect(wrapper.findComponent(Detail).props('record')).toBeNull()
    wrapper.unmount()
  })

  it('打印版本冲突给出重新加载出口，重读详情后以新意图再次登记打印（ID17）', async () => {
    vi.mocked(accessExample).mockResolvedValueOnce({ record: { ...row(1), version: 3 }, eventId: 1 })
    vi.mocked(accessExample).mockRejectedValueOnce(Object.assign(new Error('内容已更新，请刷新'), { response: { status: 409, data: { message: '内容已更新，请刷新', reason: 'version_stale' } } }))
    vi.mocked(getExample).mockResolvedValue({ ...row(1, '最新内容'), version: 4 })
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: drawerStubs } })
    await flushPromises()
    await expect(wrapper.findComponent(Detail).props('preparePrint')()).rejects.toThrow('内容已更新，请刷新')
    await flushPromises()
    expect(wrapper.text()).toContain('重新加载后打印')
    expect(wrapper.text()).not.toContain('重试同次打印')
    await wrapper.findAll('button').find(button => button.text().includes('重新加载后打印'))!.trigger('click')
    await flushPromises()
    expect(getExample).toHaveBeenCalledTimes(1)
    expect(printDetail).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('打印意图被挪用时直接换新意图重试，不需要重新加载记录', async () => {
    vi.mocked(accessExample).mockResolvedValueOnce({ record: row(1), eventId: 1 })
    vi.mocked(accessExample).mockRejectedValueOnce(Object.assign(new Error('该标识已使用'), { response: { status: 409, data: { message: '该标识已使用', reason: 'intent_reused' } } }))
    const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1 }, global: { plugins: [createPinia()], stubs: drawerStubs } })
    await flushPromises()
    await expect(wrapper.findComponent(Detail).props('preparePrint')()).rejects.toThrow('该标识已使用')
    await flushPromises()
    expect(wrapper.text()).toContain('重新发起打印')
    expect(wrapper.text()).not.toContain('重试同次打印')
    await wrapper.findAll('button').find(button => button.text().includes('重新发起打印'))!.trigger('click')
    await flushPromises()
    expect(getExample).not.toHaveBeenCalled()
    expect(printDetail).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
});
