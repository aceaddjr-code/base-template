import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import ScopeMatrixModal from './ScopeMatrixModal.vue'
import { getScopeForms, getUserDataScopes, getUsersSimple, saveUserDataScopes } from '@/api/user'
import { getDepartmentsAll } from '@/api/department'

vi.mock('@/api/user', () => ({ getScopeForms: vi.fn(), getUserDataScopes: vi.fn(), getUsersSimple: vi.fn(), saveUserDataScopes: vi.fn() }))
vi.mock('@/api/department', () => ({ getDepartmentsAll: vi.fn() }))
vi.mock('ant-design-vue', () => ({ message: { success: vi.fn(), warning: vi.fn() } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const row = (scopeKey = '__global__') => ({ scopeKey, scopeType: 'by_users' as const, targets: [7] })
function setup() {
  return mount(ScopeMatrixModal, {
    props: { open: true, target: { id: 2, name: '甲' } },
    global: { stubs: {
      AModal: { props: ['okButtonProps'], template: '<div><slot /><button class="save" :disabled="okButtonProps.disabled" @click="$emit(\'ok\')">保存</button></div>' },
      ATable: { props: ['dataSource', 'columns'], template: '<div><div v-for="record in dataSource" :key="record.scopeKey"><slot v-for="column in columns.flatMap(c => c.children || [c])" name="bodyCell" :column="column" :record="record" /></div></div>' },
      ARadioGroup: { props: ['value'], template: '<select :value="value" @change="$emit(\'change\', $event)"><option value="all">全部</option><option value="self">本人</option><option value="by_users">用户</option><option value="by_depts">部门</option></select>' },
      ASelect: { name: 'ScopeSelect', props: ['value'], template: '<span class="targets">{{ Array.isArray(value) ? value.join(",") : value }}</span>' },
      AAlert: { props: ['message'], template: '<div role="alert">{{ message }}<slot name="action" /></div>' },
      AButton: { template: '<button><slot /></button>' },
      ARadio: true,
    } },
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getScopeForms).mockResolvedValue([{ scopeKey: 'example-items', label: '示例事项' }])
  vi.mocked(getUserDataScopes).mockResolvedValue([row('example-items')])
  vi.mocked(getUsersSimple).mockResolvedValue([])
  vi.mocked(getDepartmentsAll).mockResolvedValue([])
  vi.mocked(saveUserDataScopes).mockResolvedValue([])
})
it('等待表单清单与配置全部成功后才允许保存，保留业务表单配置', async () => {
  const forms = deferred<Awaited<ReturnType<typeof getScopeForms>>>()
  vi.mocked(getScopeForms).mockReturnValue(forms.promise)
  const wrapper = setup()
  await flushPromises()
  expect(wrapper.get('.save').attributes('disabled')).toBeDefined()
  forms.resolve([{ scopeKey: 'example-items', label: '示例事项' }])
  await flushPromises()
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [row('example-items')])
  wrapper.unmount()
})
it('加载失败禁止保存，重试可恢复', async () => {
  vi.mocked(getUserDataScopes).mockRejectedValueOnce(new Error('断网'))
  const wrapper = setup(); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('加载失败')
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).not.toHaveBeenCalled()
  await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('.save').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})
it('切换目标用户后忽略上一用户迟到的配置', async () => {
  const old = deferred<Awaited<ReturnType<typeof getUserDataScopes>>>()
  vi.mocked(getUserDataScopes).mockReturnValueOnce(old.promise)
  const wrapper = setup()
  await wrapper.setProps({ target: { id: 3, name: '乙' } }); await flushPromises()
  old.resolve([{ ...row(), targets: [99] }]); await flushPromises()
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(3, [row('example-items')])
  wrapper.unmount()
})
it('切换用户范围到部门范围时清空目标，未选择新目标不能保存', async () => {
  const wrapper = setup(); await flushPromises()
  await wrapper.findAll('select')[0]!.setValue('by_depts')
  expect(wrapper.findAll('.targets')[1]!.text()).toBe('')
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('复制来源配置后需要再次保存，未配置的表单回退本人', async () => {
  const wrapper = setup(); await flushPromises()
  const source = { ...row('example-items'), scopeType: 'all' as const, targets: [] }
  vi.mocked(getUserDataScopes).mockResolvedValueOnce([source])
  wrapper.findAllComponents({ name: 'ScopeSelect' })[0]!.vm.$emit('update:value', 7)
  await wrapper.vm.$nextTick()
  await wrapper.get('.copy-scope').trigger('click')
  await flushPromises()
  expect(saveUserDataScopes).not.toHaveBeenCalled()
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [source])
  wrapper.unmount()
})

it('旧限制显示提示，保存载荷仅含可见范围', async () => {
  const config = { ...row('example-items'), legacyRestricted: true }
  vi.mocked(getUserDataScopes).mockResolvedValue([config])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('仍有旧操作限制')
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [row('example-items')])
  wrapper.unmount()
})

it('没有表单配置时默认为本人且不会套用全局设置', async () => {
  vi.mocked(getUserDataScopes).mockResolvedValue([{ ...row(), scopeType: 'all', targets: [] }])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.text()).not.toContain('继承')
  expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('self')
  await wrapper.get('.save').trigger('click')
  expect(vi.mocked(saveUserDataScopes).mock.calls[0]![1]).toEqual([{ scopeKey: 'example-items', scopeType: 'self', targets: [] }])
  wrapper.unmount()
})

it('已下线表单的存量配置行被忽略并提示，不阻塞保存', async () => {
  vi.mocked(getUserDataScopes).mockResolvedValue([row('example-items'), row('retired-form')])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.text()).toContain('已忽略 1 条已下线表单')
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [row('example-items')])
  wrapper.unmount()
})
