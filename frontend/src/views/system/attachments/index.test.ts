import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import Attachments from './index.vue'
import { getAttachments, type AttachmentItem, type AttachmentPage } from '@/api/attachment'
import { hasAccessByCodes } from '@/utils/access'
import { useAppStore } from '@/stores/app'

vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), error: vi.fn() } }))
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))
vi.mock('@/api/attachment', () => ({
  getAttachments: vi.fn(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn(), cleanupAttachments: vi.fn(),
  attachmentDownloadUrl: vi.fn(), formatSize: vi.fn(() => '1 KB'), ATTACHMENT_MAX_SIZE: 500 * 1024 * 1024,
}))
vi.mock('@/utils/access', () => ({ hasAccessByCodes: vi.fn(), hasRecordAction: vi.fn() }))

const Pass = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.left?.(), slots.actions?.(), slots.footer?.(), slots.action?.()]) } })
const Alert = defineComponent({ props: ['message', 'description'], setup(props, { slots }) { return () => h('div', [props.message, slots.action?.()]) } })
// 渲染每行每个单元格的 bodyCell 插槽，业务附件列内容（模块/单据/状态/操作）可被断言
const Table = defineComponent({
  props: { columns: { type: Array, default: () => [] }, dataSource: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('div', [
      ...props.dataSource.map((record: any) => h('div', { key: record.id, class: 'row' },
        props.columns.map((column: any) => h('span', { key: column.key }, slots.bodyCell?.({ column, record }) ?? '')))),
      h('div', [slots.emptyText?.()]),
    ])
  },
})
const Empty = defineComponent({ props: ['description'], setup(props) { return () => h('div', props.description) } })
const Button = defineComponent({ emits: ['click'], setup(_, { slots, emit }) { return () => h('button', { onClick: () => emit('click') }, slots.default?.()) } })
const Footer = defineComponent({ props: ['totalText'], setup(props) { return () => h('div', props.totalText?.(0)) } })
const Tag = defineComponent({ setup(_, { slots }) { return () => h('span', slots.default?.()) } })
const Search = defineComponent({ props: ['value'], emits: ['update:value', 'search'], setup(props, { emit }) { return () => h('input', { value: props.value, onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value), onKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter') emit('search') } }) } })

function mountPage() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAppStore().userInfo = { id: 1, username: 'admin', role: 'admin', displayName: null, avatar: null, deptId: null, deptName: null }
  const wrapper = mount(Attachments, { global: { plugins: [pinia], directives: { access: {} }, stubs: {
    Page: Pass, PageToolbar: Pass, ListFooter: Footer, AAlert: Alert, ATable: Table, AEmpty: Empty, AButton: Button, ATag: Tag,
    ATabs: Pass, ATabPane: Pass, ARadioGroup: Pass, ARadioButton: Pass, AUpload: Pass, APopconfirm: Pass,
    AInputSearch: Search, ASelect: Pass, ASpace: Pass,
  } } })
  return wrapper
}

const emptyPage: AttachmentPage = { list: [], total: 0, page: 1, pageSize: 20 }
const boundRow: AttachmentItem = {
  id: 21, name: '报价单.pdf', mimeType: 'application/pdf', size: 1024, status: 'bound', origin: 'business',
  entityType: 'example-items', entityId: 12, entityTitle: '报价事项', uploaderName: '张三', mine: false, createdAt: '2026-11-01T08:00:00Z',
}
const pendingRow: AttachmentItem = {
  id: 22, name: '草稿.docx', mimeType: 'application/msword', size: 2048, status: 'temp', origin: 'business',
  entityType: null, entityId: null, entityTitle: null, uploaderName: 'admin', mine: true, createdAt: '2026-11-02T08:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  routerPush.mockClear()
  vi.mocked(hasAccessByCodes).mockReturnValue(true)
})

it('文件库加载失败后显示重试和未知数量，重试成功恢复空状态', async () => {
  vi.mocked(getAttachments)
    .mockImplementationOnce(async () => { throw new Error('offline') })
    .mockResolvedValue(emptyPage)
  const wrapper = mountPage()
  await flushPromises()
  expect(wrapper.text()).toContain('文件库列表加载失败')
  expect(wrapper.text()).toContain('数量暂不可用')
  await wrapper.findAll('button').find(button => button.text() === '重试')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('暂无文件')
  expect(wrapper.text()).toContain('共 0 条')
  wrapper.unmount()
})

it('业务附件展示模块/单据/上传人，已挂接行可穿透且无删除，未挂接暂存行可删除', async () => {
  vi.mocked(getAttachments).mockImplementation(async (params: { origin?: string }) =>
    params.origin === 'business' ? { list: [boundRow, pendingRow], total: 2, page: 1, pageSize: 20 } : emptyPage)
  const wrapper = mountPage()
  await flushPromises()
  const rows = wrapper.findAll('.row')
  const bound = rows.find(row => row.text().includes('报价单.pdf'))!
  expect(bound.text()).toContain('示例事项')
  expect(bound.text()).toContain('报价事项')
  expect(bound.text()).toContain('张三')
  expect(bound.text()).toContain('已挂接')
  expect(bound.find('button').exists()).toBe(true)
  expect(bound.text()).not.toContain('删除')
  const drill = bound.findAll('button').find(button => button.text() === '报价事项')!
  await drill.trigger('click')
  expect(routerPush).toHaveBeenCalledWith({ path: '/examples/items', query: { detail: '12', tab: 'attachments' } })

  const pending = rows.find(row => row.text().includes('草稿.docx'))!
  expect(pending.text()).toContain('未挂接')
  expect(pending.text()).toContain('删除')
  wrapper.unmount()
})

it('无目标模块查看权限时穿透入口置灰为纯文本，并给出提示', async () => {
  vi.mocked(hasAccessByCodes).mockReturnValue(false)
  vi.mocked(getAttachments).mockImplementation(async (params: { origin?: string }) =>
    params.origin === 'business' ? { list: [boundRow], total: 1, page: 1, pageSize: 20 } : emptyPage)
  const wrapper = mountPage()
  await flushPromises()
  const bound = wrapper.findAll('.row').find(row => row.text().includes('报价单.pdf'))!
  expect(bound.find('button[title="查看示例事项详情"]').exists()).toBe(false)
  expect(bound.find('[title="需要示例事项查看权限"]').exists()).toBe(true)
  expect(routerPush).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('搜索无结果时区分筛选空态与文件库本身为空', async () => {
  vi.mocked(getAttachments).mockResolvedValue(emptyPage)
  const wrapper = mountPage()
  await flushPromises()
  expect(wrapper.text()).toContain('暂无文件')
  const input = wrapper.findAll('input')[0]!
  await input.setValue('不存在的文件')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(getAttachments).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'center', keyword: '不存在的文件' }), expect.any(AbortSignal))
  expect(wrapper.text()).toContain('没有匹配的文件')
  wrapper.unmount()
})
