import { routerKey } from 'vue-router'
import { Modal } from 'ant-design-vue'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { useAppStore } from '@/stores/app'
import { useAccessStore } from '@/stores/access'
import ExampleDetailDrawer from './ExampleDetailDrawer.vue'
import { message } from 'ant-design-vue'

// 只替换 message 弹出，便于断言全局提示；Modal 等其余能力保持真实实现。
vi.mock('ant-design-vue', async importOriginal => {
  const actual = await importOriginal<typeof import('ant-design-vue')>()
  return { ...actual, message: { ...actual.message, success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
})
vi.mock('@/api/dict', () => ({
  getDict: async () => ({ code: 'item_category', name: '事项类别', options: [] }),
  getDictAll: async () => ({ code: 'item_category', name: '事项类别', options: [] }),
}))
vi.mock('@/api/attachment', () => ({ formatSize: () => '1 KB', ATTACHMENT_MAX_SIZE: 500 * 1024 * 1024 }))
vi.mock('@/api/user', () => ({ getUsersSimple: vi.fn(async () => []) }))
import { accessExample, getExample, updateExample, changeExampleOwner, getExampleFiles, addExampleFile, uploadExampleAttachment } from '@/api/example'
import { getUsersSimple } from '@/api/user'

vi.mock('@/api/example', () => ({ accessExample: vi.fn(), uploadExampleAttachment: vi.fn(), getExample: vi.fn(), updateExample: vi.fn(), changeExampleOwner: vi.fn(), getExampleHistory: vi.fn(), getExampleFiles: vi.fn(), addExampleFile: vi.fn(), exampleFileUrl: () => '/download' }))
const startEdit = vi.fn()
const exitEditToView = vi.fn()
const printDetail = vi.fn()
const Detail = defineComponent({
  props: ['record', 'fields', 'loading', 'saveHandler', 'reloadHandler', 'preparePrint', 'closeBlocked'],
  setup(props, { expose, slots }) { expose({ startEdit, exitEditToView, printDetail }); return () => h('div', [String(props.record?.title ?? ''), slots.navigation?.(), slots.actions?.(), slots.before?.(), slots.panel?.()]) },
})
const row = (id: number, title = `记录${id}`) => ({ id, docNo: 'EX-20261102-001', title, status: 'pending' as const, description: '完整服务端说明', remark: null, ownerId: 1, createdBy: 1, version: 1, createdAt: '', updatedAt: '' })
const Alert = defineComponent({ props: ['message', 'description', 'type', 'showIcon'], setup(props) { return () => h('div', { class: 'alert-stub' }, [String(props.message ?? ''), String(props.description ?? '')]) } })
const Btn = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { type: 'button', onClick: () => emit('click') }, slots.default?.()) } })
const OkModal = defineComponent({ emits: ['ok', 'cancel'], setup(_, { emit, slots }) { return () => h('div', [slots.default?.(), h('button', { class: 'modal-ok', onClick: () => emit('ok') })]) } })
const PickSelect = defineComponent({ props: ['value', 'options'], emits: ['update:value'], render: () => h('select') })
const drawerStubs = { DetailDrawer: Detail, AAlert: Alert, AButton: Btn, AModal: OkModal, ASelect: PickSelect, AForm: { template: '<div><slot /></div>' }, AFormItem: { template: '<div><slot /></div>' } }
type DrawerProps = InstanceType<typeof ExampleDetailDrawer>['$props']
function editorPinia() {
  const pinia = createPinia()
  useAppStore(pinia).userInfo = { id: 1, username: 'editor', role: 'user', displayName: null, avatar: null, deptId: null, deptName: null }
  useAccessStore(pinia).setAccessCodes(['example-items:view', 'example-items:update', 'example-items:owner'])
  return pinia
}
const mountDrawer = (props: DrawerProps, stubs: Record<string, any> = drawerStubs) => mount(ExampleDetailDrawer, { props, global: { plugins: [editorPinia()], directives: { access: {} }, stubs } })
describe('示例详情数据生命周期', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(accessExample).mockResolvedValue({ record: row(1), eventId: 1 }) })

  it('保存提交加载时的版本号（F06）', async () => {
    vi.mocked(accessExample).mockResolvedValue({ record: { ...row(1), version: 6 }, eventId: 1 })
    vi.mocked(getExample).mockResolvedValue({ ...row(1), version: 7 })
    vi.mocked(updateExample).mockResolvedValue({ ...row(1), version: 7 })
    const wrapper = mountDrawer({ open: true, recordId: 1 })
    await flushPromises()
    expect(accessExample).toHaveBeenCalledWith(1, { action: 'view', interactionId: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/) })
    await wrapper.findComponent(Detail).props('saveHandler')({ title: '新标题' })
    expect(updateExample).toHaveBeenCalledWith(1, { title: '新标题', version: 6 }, { errorFeedback: 'form' })
    wrapper.unmount()
  })

  it('保存遇到 409 冲突时保留草稿并给出继续编辑/载入最新出口', async () => {
    vi.mocked(getExample).mockResolvedValue(row(1))
    vi.mocked(updateExample).mockRejectedValueOnce(Object.assign(new Error('记录已被他人修改或已删除，请刷新后查看最新内容'), { response: { status: 409 } }))
    const wrapper = mountDrawer({ open: true, recordId: 1 })
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
    const wrapper = mountDrawer({ open: true, recordId: 1, startInEdit: true }, { DetailDrawer: Detail })
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
    const wrapper = mountDrawer({ open: true, recordId: 1 }, { DetailDrawer: Detail })
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
    const wrapper = mountDrawer({ open: true, recordId: 1 }, { DetailDrawer: Detail })
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
    const wrapper = mountDrawer({ open: true, recordId: 1 })
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
    const wrapper = mountDrawer({ open: true, recordId: 1 })
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

  it('详情字段分三组：基础信息/动态信息/备注信息；编号与归属审计只读', async () => {
    vi.mocked(getUsersSimple).mockResolvedValue([
      { id: 1, username: 'zhang', displayName: '张三', deptId: 1, deptName: '默认部门' },
      { id: 2, username: 'li', displayName: '李四', deptId: 1, deptName: '默认部门' },
    ] as any)
    const wrapper = mountDrawer({ open: true, recordId: 1 })
    await flushPromises()
    const fields = wrapper.findComponent(Detail).props('fields') as any[]
    expect(fields.map((f) => f.group)).toEqual(['基础信息', '基础信息', '基础信息', '基础信息', '基础信息', '动态信息', '动态信息', '动态信息', '动态信息', '动态信息', '备注信息'])
    expect(fields.map((f) => f.dataIndex)).toEqual(['docNo', 'title', 'status', 'category', 'description', 'ownerId', 'memberIds', 'createdBy', 'createdAt', 'updatedAt', 'remark'])
    expect(fields.filter((f) => f.editable).map((f) => f.dataIndex)).toEqual(['title', 'status', 'category', 'description', 'memberIds', 'remark'])
    // 归属人姓名按用户简表解析；解析不到回退「-」
    const owner = fields.find((f) => f.dataIndex === 'ownerId')!
    expect(owner.formatter({ ownerId: 2 })).toBe('李四（默认部门）')
    expect(owner.formatter({ ownerId: 99 })).toBe('-')
    expect(fields.find((f) => f.dataIndex === 'remark')!.span).toBe(2)
    wrapper.unmount()
  })

  it('变更负责人：预填当前负责人，确认后走独立接口并重读详情', async () => {
    vi.mocked(getUsersSimple).mockResolvedValue([
      { id: 1, username: 'zhang', displayName: '张三', deptId: 1, deptName: '默认部门' },
      { id: 2, username: 'li', displayName: '李四', deptId: 1, deptName: '默认部门' },
    ] as any)
    vi.mocked(changeExampleOwner).mockResolvedValue(row(1))
    const wrapper = mountDrawer({ open: true, recordId: 1 })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('变更负责人'))!.trigger('click')
    const select = wrapper.findComponent(PickSelect)
    expect(select.props('value')).toBe(1)
    // 未改选（仍为当前负责人）时确认不发起请求
    await wrapper.find('button.modal-ok').trigger('click')
    expect(changeExampleOwner).not.toHaveBeenCalled()
    select.vm.$emit('update:value', 2)
    await flushPromises()
    await wrapper.find('button.modal-ok').trigger('click')
    await flushPromises()
    expect(changeExampleOwner).toHaveBeenCalledWith(1, 2)
    expect(getExample).toHaveBeenCalledWith(1)
    expect(wrapper.emitted('updated')).toBeTruthy()
    wrapper.unmount()
  })

  it('变更负责人未选择时给出提示，不发起请求', async () => {
    const wrapper = mountDrawer({ open: true, recordId: 1 })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('变更负责人'))!.trigger('click')
    wrapper.findComponent(PickSelect).vm.$emit('update:value', null)
    await flushPromises()
    await wrapper.find('button.modal-ok').trigger('click')
    await flushPromises()
    expect(changeExampleOwner).not.toHaveBeenCalled()
    expect(vi.mocked(message.warning)).toHaveBeenCalledWith('请选择新的单据负责人')
    wrapper.unmount()
  })
});

it('上传期间切换页签保留实例并阻止关闭，完成后仍保存到原单据', async () => {
  vi.clearAllMocks()
  vi.mocked(accessExample).mockResolvedValue({ record: row(1), eventId: 1 })
  vi.mocked(getExampleFiles).mockResolvedValue([])
  let finish!: (value: any) => void
  vi.mocked(uploadExampleAttachment).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(addExampleFile).mockResolvedValue({ id: 9 })
  const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1, tab: 'attachments' }, global: { plugins: [editorPinia()], directives: { access: {} }, stubs: { DetailDrawer: Detail, AButton: Btn, AAlert: Alert, AImage: true, APopconfirm: true } } })
  await flushPromises()
  const panel = wrapper.getComponent({ name: 'ExampleAttachmentPanel' })
  const input = panel.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['data'], '测试.pdf')] })
  await input.trigger('change'); await flushPromises()
  expect(wrapper.getComponent(Detail).props('closeBlocked')).toBe(true)
  await wrapper.setProps({ tab: 'detail' })
  expect(wrapper.getComponent({ name: 'ExampleAttachmentPanel' }).vm.$.uid).toBe(panel.vm.$.uid)
  wrapper.getComponent(Detail).vm.$emit('update:open', false); await flushPromises()
  expect(wrapper.emitted('update:open')).toBeUndefined()
  finish({ id: 9 }); await flushPromises()
  expect(addExampleFile).toHaveBeenCalledWith(1, 9)
  await wrapper.setProps({ tab: 'attachments' })
  expect(wrapper.text()).not.toContain('重试保存')
  wrapper.unmount()
})

it('待保存文件切页仍可重试，切换记录或关闭时可选择继续保留', async () => {
  vi.clearAllMocks()
  vi.mocked(accessExample).mockResolvedValue({ record: row(1), eventId: 1 })
  vi.mocked(getExampleFiles).mockResolvedValue([])
  vi.mocked(uploadExampleAttachment).mockResolvedValue({ id: 10 } as any)
  vi.mocked(addExampleFile).mockRejectedValueOnce(new Error('挂接失败')).mockResolvedValue({ id: 10 })
  let guard!: (to: any, from: any) => any
  const router = { beforeEach: (fn: typeof guard) => { guard = fn; return () => {} } }
  const confirm = vi.spyOn(Modal, 'confirm').mockImplementation((config: any) => { config.onCancel(); return { destroy: vi.fn(), update: vi.fn() } })
  const wrapper = mount(ExampleDetailDrawer, { props: { open: true, recordId: 1, tab: 'attachments' }, global: { plugins: [editorPinia()], provide: { [routerKey as symbol]: router }, directives: { access: {} }, stubs: { DetailDrawer: Detail, AButton: Btn, AAlert: Alert, AImage: true, APopconfirm: true } } })
  await flushPromises()
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['data'], '测试.pdf')] })
  await input.trigger('change'); await flushPromises()
  const from = { fullPath: '/items?detail=1&tab=attachments', path: '/items', query: { detail: '1' } }
  expect(await guard({ fullPath: '/items?detail=2', path: '/items', query: { detail: '2' } }, from)).toBe(false)
  wrapper.getComponent(Detail).vm.$emit('update:open', false); await flushPromises()
  expect(wrapper.emitted('update:open')).toBeUndefined()
  await wrapper.setProps({ tab: 'detail' }); await wrapper.setProps({ tab: 'attachments' })
  expect(wrapper.text()).toContain('重试保存')
  await wrapper.findAll('button').find(button => button.text() === '重试保存')!.trigger('click'); await flushPromises()
  expect(uploadExampleAttachment).toHaveBeenCalledTimes(1)
  expect(addExampleFile).toHaveBeenLastCalledWith(1, 10)
  wrapper.unmount(); confirm.mockRestore()
})
