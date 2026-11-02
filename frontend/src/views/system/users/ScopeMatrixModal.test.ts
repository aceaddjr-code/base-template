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
const row = (scopeKey = '__global__') => ({ scopeKey, scopeType: 'by_users' as const, targets: [7], viewOthers: 1, editOthers: 0, deleteOthers: 0, viewSelf: 1, editSelf: 1, deleteSelf: 1 })
function setup() {
  return mount(ScopeMatrixModal, {
    props: { open: true, target: { id: 2, name: '甲' } },
    global: { stubs: {
      AModal: { props: ['okButtonProps'], template: '<div><slot /><button class="save" :disabled="okButtonProps.disabled" @click="$emit(\'ok\')">保存</button></div>' },
      ATable: { props: ['dataSource', 'columns'], template: '<div><div v-for="record in dataSource" :key="record.scopeKey"><slot v-for="column in columns" name="bodyCell" :column="column" :record="record" /></div></div>' },
      ARadioGroup: { props: ['value'], template: '<select :value="value" @change="$emit(\'change\', $event)"><option value="all">全部</option><option value="self">本人</option><option value="by_users">用户</option><option value="by_depts">部门</option></select>' },
      ASelect: { name: 'ScopeSelect', props: ['value'], template: '<span class="targets">{{ Array.isArray(value) ? value.join(",") : value }}</span>' },
      AAlert: { props: ['message'], template: '<div role="alert">{{ message }}<slot name="action" /></div>' },
      AButton: { template: '<button><slot /></button>' },
      ARadio: true,
      ACheckbox: { props: ['checked', 'disabled'], template: '<input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'update:checked\', $event.target.checked)" />' },
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
  expect(wrapper.findAll('.targets')[0]!.text()).toBe('')
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('六个开关回显和保存，共用同一组目标', async () => {
  const config = { ...row('example-items'), viewSelf: 0, editSelf: 0, deleteSelf: 1, viewOthers: 1, editOthers: 0, deleteOthers: 1 }
  vi.mocked(getUserDataScopes).mockResolvedValue([config])
  const wrapper = setup(); await flushPromises()
  const checks = wrapper.findAll('input[type="checkbox"]')
  expect(checks.slice(0, 6).map(input => (input.element as HTMLInputElement).checked)).toEqual([true, false, false, false, true, true])
  await checks[3]!.setValue(true)
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [{ ...config, editSelf: 1 }])
  wrapper.unmount()
})

it('没有表单配置时默认为本人且不会套用全局设置', async () => {
  vi.mocked(getUserDataScopes).mockResolvedValue([{ ...row(), scopeType: 'all', targets: [], viewSelf: 0 }])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.text()).not.toContain('继承')
  expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('self')
  expect((wrapper.findAll('input[type="checkbox"]')[1]!.element as HTMLInputElement).checked).toBe(true)
  await wrapper.get('.save').trigger('click')
  expect(vi.mocked(saveUserDataScopes).mock.calls[0]![1]).toMatchObject([{ scopeKey: 'example-items', scopeType: 'self', viewSelf: 1 }])
  wrapper.unmount()
})

it('已下线表单的存量配置行被忽略并提示，不阻塞保存', async () => {
  vi.mocked(getUserDataScopes).mockResolvedValue([row('example-items'), { ...row('retired-form'), viewSelf: 0 }])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.text()).toContain('已忽略 1 条已下线表单')
  expect((wrapper.findAll('input[type="checkbox"]')[1]!.element as HTMLInputElement).checked).toBe(true)
  await wrapper.get('.save').trigger('click')
  expect(saveUserDataScopes).toHaveBeenCalledWith(2, [row('example-items')])
  wrapper.unmount()
})
