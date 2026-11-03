import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Items from './index.vue'
import { batchDeleteExamples, createExample, listExamples } from '@/api/example'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app'
import { clearListQueryState } from '@/composables/useListQuery'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/composables/useDetailDeepLink', () => ({ useDetailDeepLink: () => ({ attach: vi.fn() }) }))
vi.mock('@/api/example', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/example')>()
  return { ...original, listExamples: vi.fn(), batchDeleteExamples: vi.fn(), createExample: vi.fn(), updateExample: vi.fn(), deleteExample: vi.fn(), importExamples: vi.fn() }
})
const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.footer?.()]) } })
const Alert = defineComponent({ props: ['message', 'description', 'type'], setup(props) { return () => h('div', [String(props.message ?? ''), String(props.description ?? '')]) } })
// 工具栏 stub 必须渲染 #left 插槽：筛选区已并入工具栏左区，否则测试拿不到 ListFilters。
const Toolbar = defineComponent({ props: ['exportUrl', 'columns', 'allColumns', 'keyword'], emits: ['update:columns', 'update:keyword'], setup(_, { slots }) { return () => h('div', [slots.left?.(), slots.default?.()]) } })
const Table = defineComponent({ props: ['rowSelection'], emits: ['change'], setup() { return () => h('div') } })
const Footer = defineComponent({ props: ['pagination'], emits: ['change'], setup() { return () => h('div') } })
const Confirm = defineComponent({ emits: ['confirm'], setup(_, { slots }) { return () => h('div', slots.default?.()) } })
const Button = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { onClick: () => emit('click') }, slots.default?.()) } })
const Filters = defineComponent({ props: ['dirty', 'tags'], emits: ['apply', 'remove', 'reset'], setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.more?.()]) } })
const Input = defineComponent({ props: ['value'], emits: ['update:value'], render: () => h('input') })
const Select = defineComponent({ props: ['value'], emits: ['update:value'], render: () => h('div') })
const Textarea = defineComponent({ props: ['value'], emits: ['update:value'], render: () => h('textarea') })
const Modal = defineComponent({ emits: ['ok', 'cancel'], setup(_, { emit, slots }) { return () => h('div', [slots.default?.(), h('button', { class: 'modal-ok', onClick: () => emit('ok') })]) } })
const Range = defineComponent({ props: ['value'], emits: ['update:value'], render: () => h('div') })
function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: Pass }] })
  void router.push('/examples/items')
  useAppStore().userInfo = { id: 1, username: 'admin', role: 'admin', displayName: null, avatar: null, deptId: null, deptName: null }
  return mount(Items, { global: { plugins: [pinia, router], directives: { access: {} }, stubs: {
    Page: Pass, PageToolbar: Toolbar, ListFooter: Footer, ExampleDetailDrawer: true,
    ListFilters: Filters, ARangePicker: Range,
    ATable: Table, AButton: Button, APopconfirm: Confirm, AModal: Modal, AAlert: Alert, ATag: Pass, ASpace: Pass,
    AForm: Pass, AFormItem: Pass, AInput: Input, ASelect: Select, ATextarea: Textarea,
  } } })
}
const exportParams = (url: string) => new URL(url, 'http://localhost').searchParams
describe('示例标准页导出和勾选联动', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearListQueryState()
    localStorage.clear()
    vi.mocked(listExamples).mockResolvedValue({ list: [], total: 2 })
  })

  it('筛选、排序与可见列共同影响导出，操作列与分页参数不进入导出', async () => {
    const wrapper = setup()
    await flushPromises()
    const toolbar = wrapper.findComponent(Toolbar)
    wrapper.findComponent(Input).vm.$emit('update:value', '  已筛选内容  ')
    wrapper.findComponent(Select).vm.$emit('update:value', ['doing'])
    await flushPromises()
    expect(exportParams(toolbar.props('exportUrl')).get('keyword')).toBeNull()
    wrapper.findComponent(Filters).vm.$emit('apply')
    wrapper.findComponent(Table).vm.$emit('change', {}, { status: ['doing'] }, { field: 'title', order: 'ascend' })
    toolbar.vm.$emit('update:columns', [{ key: 'status' }, { key: 'title' }, { key: 'actions' }])
    await flushPromises()
    const params = exportParams(toolbar.props('exportUrl'))
    expect(Object.fromEntries(params)).toEqual({ keyword: '已筛选内容', status: 'doing', sortBy: 'title', sortOrder: 'ASC', cols: 'status,title' })
    expect(vi.mocked(listExamples).mock.lastCall?.[0]).toMatchObject({ keyword: '已筛选内容', status: 'doing', sortBy: 'title', sortOrder: 'ASC' })
    wrapper.unmount()
  })

  it('导出选中保留当前筛选和可见列；翻页会清理上页勾选', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = setup()
    try {
      await flushPromises()
      wrapper.findComponent(Input).vm.$emit('update:value', '目标')
      await flushPromises()
      wrapper.findComponent(Filters).vm.$emit('apply')
      await flushPromises()
      wrapper.findComponent(Table).props('rowSelection').onChange([1, 2])
      await flushPromises()
      await wrapper.findAll('button').find(button => button.text() === '导出选中')!.trigger('click')
      const params = exportParams(String(opened.mock.lastCall?.[0]))
      expect(params.get('ids')).toBe('1,2')
      expect(params.get('keyword')).toBe('目标')
      expect(params.get('cols')).toBe('docNo,title,status,category,description,updatedAt')
      wrapper.findComponent(Footer).vm.$emit('change', 2, 10)
      await flushPromises()
      expect(wrapper.findComponent(Table).props('rowSelection').selectedRowKeys).toEqual([])
    } finally { wrapper.unmount(); opened.mockRestore() }
  })

  it('字段注册表派生列设置全集：新增字段自动进列设置且默认不勾选', async () => {
    const wrapper = setup()
    await flushPromises()
    const toolbar = wrapper.findComponent(Toolbar)
    // 列设置全集 = 注册表全部字段 + 操作列（锁尾）；默认隐藏字段（勾选后才上列表）也在全集内
    const allKeys = (toolbar.props('allColumns') as { key: string }[]).map(column => column.key)
    expect(allKeys).toEqual(['docNo', 'title', 'status', 'category', 'description', 'ownerId', 'createdBy', 'createdAt', 'updatedAt', 'remark', 'actions'])
    // 默认可见列保持原有 6 列 + 操作列：新增字段经列设置勾选开启，不静默改变存量列表
    const visibleKeys = (toolbar.props('columns') as { key: string }[]).map(column => column.key)
    expect(visibleKeys).toEqual(['docNo', 'title', 'status', 'category', 'description', 'updatedAt', 'actions'])
    wrapper.unmount()
  })

  it('新增弹窗提交标题与备注，单据编号不进载荷（后端生成）', async () => {
    vi.mocked(createExample).mockResolvedValue({ id: 9 } as any)
    const wrapper = setup()
    await flushPromises()
    wrapper.findComponent(Toolbar).vm.$emit('create')
    await flushPromises()
    const inputs = wrapper.findAllComponents(Input)
    // [0] 是工具栏筛选关键词输入，[1] 才是弹窗标题
    inputs[1].vm.$emit('update:value', '事项')
    const textareas = wrapper.findAllComponents(Textarea)
    // 弹窗内说明在前、备注在后
    textareas[1].vm.$emit('update:value', '加急处理')
    await flushPromises()
    await wrapper.findComponent(Modal).find('button.modal-ok').trigger('click')
    await flushPromises()
    expect(vi.mocked(createExample)).toHaveBeenCalledWith({ title: '事项', status: 'pending', description: '', remark: '加急处理', category: '' }, { errorFeedback: 'form' })
    expect(JSON.stringify(vi.mocked(createExample).mock.calls[0][0])).not.toContain('docNo')
    wrapper.unmount()
  })

  it('批量部分失败保留逐条结果，成功后刷新并清理勾选', async () => {
    vi.mocked(batchDeleteExamples).mockResolvedValue({ successCount: 1, total: 2, failures: [{ id: 2, reason: '没有删除他人单据的权限' }] })
    const wrapper = setup()
    await flushPromises()
    wrapper.findComponent(Table).props('rowSelection').onChange([1, 2])
    await flushPromises()
    wrapper.findComponent(Confirm).vm.$emit('confirm')
    await flushPromises()
    expect(batchDeleteExamples).toHaveBeenCalledWith([1, 2])
    expect(wrapper.text()).toContain('记录 #2：没有删除他人单据的权限')
    expect(wrapper.findComponent(Table).props('rowSelection').selectedRowKeys).toEqual([])
    expect(listExamples).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('批量失败可仅重试明确失败的记录,成功项不再次提交', async () => {
    vi.mocked(batchDeleteExamples)
      .mockResolvedValueOnce({ successCount: 1, total: 2, failures: [{ id: 2, reason: '没有删除他人单据的权限' }] })
      .mockResolvedValueOnce({ successCount: 1, total: 1, failures: [] })
    const wrapper = setup()
    await flushPromises()
    wrapper.findComponent(Table).props('rowSelection').onChange([1, 2])
    await flushPromises()
    wrapper.findComponent(Confirm).vm.$emit('confirm')
    await flushPromises()
    expect(wrapper.text()).toContain('仅重试失败的 1 条')
    const retry = wrapper.findAll('button').find((button) => button.text().includes('仅重试失败'))
    await retry!.trigger('click')
    await flushPromises()
    expect(vi.mocked(batchDeleteExamples)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(batchDeleteExamples)).toHaveBeenLastCalledWith([2])
    expect(wrapper.text()).toContain('成功 2/2 条')
    expect(wrapper.text()).toContain('本次批次已全部处理完成')
    wrapper.unmount()
  })

  it('批量请求未返回逐条结果时显示结果待确认,不提供失败重试', async () => {
    vi.mocked(batchDeleteExamples).mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: undefined }))
    const wrapper = setup()
    await flushPromises()
    wrapper.findComponent(Table).props('rowSelection').onChange([1])
    await flushPromises()
    wrapper.findComponent(Confirm).vm.$emit('confirm')
    await flushPromises()
    expect(wrapper.text()).toContain('结果待确认')
    expect(wrapper.text()).not.toContain('仅重试失败')
    expect(listExamples).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('整批被拒绝(4xx)未执行删除,不显示结果面板', async () => {
    vi.mocked(batchDeleteExamples).mockRejectedValueOnce(Object.assign(new Error('请选择 1 至 500 条有效记录'), { response: { status: 400 } }))
    const wrapper = setup()
    await flushPromises()
    wrapper.findComponent(Table).props('rowSelection').onChange([1])
    await flushPromises()
    wrapper.findComponent(Confirm).vm.$emit('confirm')
    await flushPromises()
    expect(wrapper.text()).not.toContain('结果待确认')
    expect(wrapper.text()).not.toContain('成功 0/1 条')
    wrapper.unmount()
  })

  it('失败明细可下载为 CSV 文件', async () => {
    vi.mocked(batchDeleteExamples).mockResolvedValueOnce({ successCount: 1, total: 2, failures: [{ id: 2, reason: '没有权限,请联系管理员' }] })
    const createObjectURL = vi.fn(() => 'blob:x')
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    const wrapper = setup()
    try {
      await flushPromises()
      wrapper.findComponent(Table).props('rowSelection').onChange([1, 2])
      await flushPromises()
      wrapper.findComponent(Confirm).vm.$emit('confirm')
      await flushPromises()
      const download = wrapper.findAll('button').find((button) => button.text() === '下载失败明细')
      await download!.trigger('click')
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    } finally { wrapper.unmount() }
  })
})
