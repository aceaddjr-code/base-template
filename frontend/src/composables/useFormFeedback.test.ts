import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { useFormFeedback } from './useFormFeedback'
function setup() {
  let feedback!: ReturnType<typeof useFormFeedback>
  const values = ref({ title: '', email: '' })
  const wrapper = mount(defineComponent({ setup() {
    const root = ref<HTMLElement | null>(null)
    feedback = useFormFeedback({ root, fields: () => ({ title: '标题', email: '邮箱' }), values: () => ({ ...values.value }) })
    return () => h('div', { ref: root }, [h('div', { 'data-form-field': 'title' }, h('input')), h('div', { 'data-feedback-summary': true, tabindex: -1 })])
  } }), { attachTo: document.body })
  return { feedback, values, wrapper }
}
describe('表单字段与摘要反馈', () => {
  it('客户端一次列出全部错误并聚焦首错，修改字段只清理自己的错误', async () => {
    const { feedback, values, wrapper } = setup()
    expect(await feedback.validate({ title: '请填写标题', email: '邮箱无效' })).toBe(false)
    expect(feedback.summary.value).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.find('input').element)
    expect(feedback.attrs('title')['aria-invalid']).toBe(true)
    values.value.title = '修正标题'; await flushPromises()
    expect(feedback.errors.value).toEqual({ email: '邮箱无效' })
    wrapper.unmount()
  })
  it('只按声明路径映射服务端错误，未知字段保留在摘要，不解析中文猜字段', async () => {
    const { feedback, wrapper } = setup()
    await feedback.capture({ requestId: 'form-123', response: { data: { message: '失败', fieldErrors: [
      { path: 'title', code: 'required', message: '标题不能为空' }, { path: 'title', code: 'length', message: '标题长度无效' }, { path: 'rows.0.price', code: 'min', message: '子项价格无效' },
    ] } } })
    expect(feedback.errors.value).toEqual({ title: '标题不能为空；标题长度无效' })
    expect(feedback.summary.value).toContainEqual({ label: '', message: '子项价格无效' })
    expect(feedback.requestId.value).toBe('form-123')
    await feedback.capture({ response: { data: { message: '邮箱规则由服务器裁决' } } })
    expect(feedback.errors.value).toEqual({})
    expect(feedback.summary.value[0]!.message).toBe('邮箱规则由服务器裁决')
    expect(feedback.requestId.value).toBeUndefined()
    wrapper.unmount()
  })
  it('网络结果未知时说明核对后重试，保留表单输入', async () => {
    const { feedback, values, wrapper } = setup()
    values.value.title = '本次草稿'
    await feedback.capture(new Error('timeout'))
    expect(feedback.summary.value[0]!.message).toContain('先核对记录')
    expect(values.value.title).toBe('本次草稿')
    wrapper.unmount()
  })
})
