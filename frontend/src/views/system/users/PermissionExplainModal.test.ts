import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import PermissionExplainModal from './PermissionExplainModal.vue'
import { explainUserPermissions, getScopeForms } from '@/api/user'
import type { PermissionExplanation } from '@/api/user'

vi.mock('@/api/user', () => ({ getScopeForms: vi.fn(), explainUserPermissions: vi.fn() }))
vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), warning: vi.fn() } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const explanation = (overrides: Partial<PermissionExplanation> = {}): PermissionExplanation => ({
  evaluatedAt: '2026-11-04T10:00:00.000Z',
  targetUserId: 5,
  tokenVersion: 3,
  configSource: { scopeKey: 'example-items', scopeFormLabel: '示例事项', configured: true, fallback: null },
  account: { status: 1, mustChangePassword: false },
  operationPermissions: [
    { action: 'detail', permissionCode: 'example-items:view', effective: true, sources: [{ roleId: 2, roleCode: 'user', roleName: '普通用户', roleEnabled: true }], adminException: false },
    { action: 'update', permissionCode: 'example-items:update', effective: false, sources: [], adminException: false },
  ],
  dataScope: { scopeType: 'self', flags: { viewSelf: 1, viewOthers: 0, editSelf: 1, editOthers: 0, deleteSelf: 1, deleteOthers: 0 }, description: '仅本人单据' },
  recordEvaluation: [
    { action: 'detail', result: 'allowed', reasonCodes: [], readableReason: '共同范围内且查看开关开启' },
    { action: 'update', result: 'denied', reasonCodes: ['OPERATION_PERMISSION_MISSING'], readableReason: '缺少操作权限码 example-items:update' },
  ],
  record: { id: 50, docNo: 'EX-20261104-001', title: '事项甲', ownerId: 5, ownerLabel: '用户甲', deleted: false },
  ...overrides,
})

const target = (id: number, username = `user-${id}`) => ({ id, username, displayName: null, email: null, phone: null, status: 1, role: null, deptId: null, leaderId: null, createdAt: '', updatedAt: '' })

function setup(props: { open: boolean; target: ReturnType<typeof target> | null }) {
  return mount(PermissionExplainModal, {
    props,
    global: { stubs: {
      AModal: { props: ['open'], template: '<div v-if="open"><slot name="title" /><slot /></div>' },
      ASelect: { props: ['value', 'disabled', 'loading'], template: '<select class="scope-select" :disabled="disabled" @change="$emit(\'update:value\', $event.target.value); $emit(\'change\', $event.target.value)"><option value="example-items">示例事项</option><option value="attachments">附件管理</option></select>' },
      AInput: { props: ['value', 'disabled'], template: '<input class="record-input" :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value); $emit(\'change\', $event)" />' },
      AButton: { props: ['loading', 'disabled'], template: '<button class="query" :disabled="disabled || loading"><slot /></button>' },
      ATag: { props: ['color'], template: '<span class="tag" :data-color="color"><slot /></span>' },
      AAlert: { props: ['message', 'description'], template: '<div role="alert">{{ message }}：{{ description }}<slot name="action" /></div>' },
      AEmpty: { props: ['description'], template: '<div class="empty">{{ description }}</div>' },
      ASpin: { template: '<div class="spin" />' },
      ABadge: { props: ['status', 'text'], template: '<span class="badge">{{ text }}</span>' },
      SafetyCertificateOutlined: true,
    } },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getScopeForms).mockResolvedValue([{ scopeKey: 'example-items', label: '示例事项' }, { scopeKey: 'attachments', label: '附件管理' }])
})

it('打开加载表单清单并默认选中第一项；查询成功后仅展示后端裁决结果', async () => {
  vi.mocked(explainUserPermissions).mockResolvedValue(explanation())
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(explainUserPermissions).toHaveBeenCalledWith(5, { scopeKey: 'example-items' })
  const body = wrapper.get('[data-testid="explain-result"]').text()
  expect(body).toContain('仅本人单据')
  expect(body).toContain('普通用户')
  expect(body).toContain('缺少操作权限码 example-items:update')
  expect(body).toContain('EX-20261104-001')
  wrapper.unmount()
})

it('无已注册表单时空态提示，不允许查询', async () => {
  vi.mocked(getScopeForms).mockResolvedValue([])
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  expect(wrapper.get('.empty').text()).toContain('暂无已注册的业务表单')
  expect(wrapper.get('.query').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('切换目标清除旧结果，上一用户的结果不闪现为当前结果', async () => {
  vi.mocked(explainUserPermissions).mockResolvedValue(explanation())
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(true)
  await wrapper.setProps({ target: target(6) })
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(false)
  wrapper.unmount()
})

it('在途请求遇目标切换后到达被丢弃；新查询接管，修改记录 ID 清除旧结果', async () => {
  const first = deferred<PermissionExplanation>()
  vi.mocked(explainUserPermissions).mockReturnValueOnce(first.promise).mockResolvedValueOnce(explanation({ targetUserId: 6 }))
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  await wrapper.get('.query').trigger('click')
  // 旧请求在途时切换目标：清除旧结果；旧响应到达后凭目标不匹配被丢弃
  await wrapper.setProps({ target: target(6) })
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(false)
  first.resolve(explanation({ targetUserId: 5 }))
  await flushPromises()
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(false)
  // 新目标的查询正常返回并渲染
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  const body = wrapper.get('[data-testid="explain-result"]').text()
  expect(body).toContain('v3')
  expect(explainUserPermissions).toHaveBeenCalledTimes(2)
  // 修改记录引用输入后旧结果清除
  await wrapper.get('.record-input').setValue('88')
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(false)
  wrapper.unmount()
})

it('单据编号输入以 recordNo 传参；非法输入本地拦截并提示格式', async () => {
  vi.mocked(explainUserPermissions).mockResolvedValue(explanation())
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  // 非法输入：不发请求，提示格式
  await wrapper.get('.record-input').setValue('随便写的')
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(explainUserPermissions).not.toHaveBeenCalled()
  expect(wrapper.get('[role="alert"]').text()).toContain('单据编号')
  // 单据编号：以 recordNo 传参并渲染结果
  await wrapper.get('.record-input').setValue('ex-20261104-001')
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(explainUserPermissions).toHaveBeenCalledWith(5, { scopeKey: 'example-items', recordNo: 'EX-20261104-001' })
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(true)
  // 纯数字：以 recordId 传参
  vi.mocked(explainUserPermissions).mockClear()
  vi.mocked(explainUserPermissions).mockResolvedValue(explanation())
  await wrapper.get('.record-input').setValue('66')
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(explainUserPermissions).toHaveBeenCalledWith(5, { scopeKey: 'example-items', recordId: 66 })
  wrapper.unmount()
})

it('请求失败展示失败态并可重试，不残留旧成功结果', async () => {
  vi.mocked(explainUserPermissions).mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { data: { message: '服务暂不可用' } } }))
  const wrapper = setup({ open: true, target: target(5) })
  await flushPromises()
  await wrapper.get('.query').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('服务暂不可用')
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(false)
  vi.mocked(explainUserPermissions).mockResolvedValueOnce(explanation())
  await wrapper.get('[role="alert"] button').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="explain-result"]').exists()).toBe(true)
  wrapper.unmount()
})
