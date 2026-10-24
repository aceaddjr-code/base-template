import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Modal } from 'ant-design-vue'
import { useFormModal, type FormModalSaveResult } from './useFormModal'

vi.mock('ant-design-vue', () => ({ Modal: { confirm: vi.fn() } }))

type TestForm = { name: string; remark: string }

function setup(options?: {
  save?: (form: TestForm, editId: string | number | null) => Promise<FormModalSaveResult>
  onClosed?: () => void
}) {
  let session!: ReturnType<typeof useFormModal<TestForm>>
  const save = options?.save ?? (async () => undefined)
  const wrapper = mount(defineComponent({
    setup() {
      session = useFormModal<TestForm>({
        fields: () => ({ name: '名称' }),
        defaults: () => ({ name: '', remark: '' }),
        validate: form => (form.name.trim() ? {} : { name: '请填写名称' }),
        save: (form, editId) => save(form, editId),
        ...(options?.onClosed ? { onClosed: options.onClosed } : {}),
      })
      return () => h('div', { ref: session.bindRoot }, h('input'))
    },
  }), { attachTo: document.body })
  return { session, wrapper, save }
}

describe('表单弹窗状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(Modal.confirm).mockImplementation(({ onCancel }) => { onCancel?.(); return { destroy: vi.fn() } as unknown as ReturnType<typeof Modal.confirm> })
  })

  it('open 重置上次残留并重拍基线，干净关闭不弹确认', async () => {
    const onClosed = vi.fn()
    const { session, wrapper } = setup({ onClosed })
    session.open(null, { name: '甲' })
    expect(session.visible.value).toBe(true)
    expect(session.form.name).toBe('甲')
    session.open()
    expect(session.form.name).toBe('')
    session.open(7, { name: '乙' })
    expect(session.editId.value).toBe(7)
    session.close()
    await flushPromises()
    expect(Modal.confirm).not.toHaveBeenCalled()
    expect(session.visible.value).toBe(false)
    expect(onClosed).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('脏表单关闭需确认：取消保留会话，确认后关闭并回调', async () => {
    const onClosed = vi.fn()
    const { session, wrapper } = setup({ onClosed })
    session.open()
    session.form.name = '未保存内容'
    session.close()
    await flushPromises()
    expect(session.visible.value).toBe(true)
    expect(onClosed).not.toHaveBeenCalled()
    vi.mocked(Modal.confirm).mockImplementationOnce(({ onOk }) => { onOk?.(); return { destroy: vi.fn() } as unknown as ReturnType<typeof Modal.confirm> })
    session.close()
    await flushPromises()
    expect(session.visible.value).toBe(false)
    expect(onClosed).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('本地校验失败时列出字段错误且不调用保存', async () => {
    const save = vi.fn(async () => undefined)
    const { session, wrapper } = setup({ save })
    session.open()
    await session.submit()
    expect(save).not.toHaveBeenCalled()
    expect(session.feedback.errors.value.name).toBe('请填写名称')
    expect(session.visible.value).toBe(true)
    wrapper.unmount()
  })

  it('保存成功结束会话；返回 continue 时重置表单并保持打开', async () => {
    const onClosed = vi.fn()
    const save = vi.fn(async (): Promise<FormModalSaveResult> => 'continue')
    const { session, wrapper } = setup({ save, onClosed })
    session.open(null, { name: '连录', remark: '备注' })
    await session.submit()
    expect(session.visible.value).toBe(true)
    expect(session.form).toEqual({ name: '', remark: '' })
    expect(onClosed).not.toHaveBeenCalled()
    save.mockResolvedValue(undefined)
    session.form.name = '再次提交'
    await session.submit()
    expect(session.visible.value).toBe(false)
    expect(onClosed).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('保存抛错映射到字段反馈，会话保留且加载锁复位', async () => {
    const save = vi.fn(async () => { throw { response: { data: { fieldErrors: [{ path: 'name', code: 'duplicate', message: '名称已存在' }] } } } })
    const { session, wrapper } = setup({ save })
    session.open(null, { name: '重名' })
    await session.submit()
    expect(session.feedback.errors.value.name).toBe('名称已存在')
    expect(session.visible.value).toBe(true)
    expect(session.loading.value).toBe(false)
    expect(session.modalProps.value.confirmLoading).toBe(false)
    wrapper.unmount()
  })

  it('保存期间 modalProps 锁定关闭入口', async () => {
    let release!: (value: FormModalSaveResult) => void
    const { session, wrapper } = setup({ save: () => new Promise<FormModalSaveResult>(resolve => { release = resolve }) })
    session.open(null, { name: '提交中' })
    expect(session.modalProps.value).toEqual({ confirmLoading: false, maskClosable: true, keyboard: true, closable: true, cancelButtonProps: { disabled: false } })
    const pending = session.submit()
    await flushPromises()
    expect(session.modalProps.value).toEqual({ confirmLoading: true, maskClosable: false, keyboard: false, closable: false, cancelButtonProps: { disabled: true } })
    release(undefined)
    await pending
    expect(session.modalProps.value.confirmLoading).toBe(false)
    wrapper.unmount()
  })
})
