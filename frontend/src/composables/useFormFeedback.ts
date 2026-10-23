import { computed, nextTick, ref, useId, watch, type Ref } from 'vue'

export interface FeedbackItem { field?: string; label: string; message: string }
export function useFormFeedback(options: { fields: () => Record<string, string>; root: Ref<HTMLElement | null>; values?: () => Record<string, unknown>; beforeFocus?: () => void }) {
  const errors = ref<Record<string, string>>({})
  const general = ref<string[]>([])
  const requestId = ref<string>()
  const prefix = useId()
  const summary = computed<FeedbackItem[]>(() => [
    ...Object.entries(errors.value).map(([field, message]) => ({ field, label: options.fields()[field] ?? field, message })),
    ...general.value.map(message => ({ label: '', message })),
  ])
  const attrs = (field: string) => ({ 'aria-invalid': !!errors.value[field], 'aria-describedby': errors.value[field] ? `${prefix}-${field}` : undefined })
  function clear() { errors.value = {}; general.value = []; requestId.value = undefined }
  async function focus(field?: string) {
    const key = field ?? Object.keys(errors.value)[0]
    options.beforeFocus?.()
    await nextTick()
    const wrapper = Array.from(options.root.value?.querySelectorAll<HTMLElement>('[data-form-field]') ?? []).find(element => element.dataset.formField === key)
    const target = wrapper?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),[role="combobox"],select:not([disabled]),button:not([disabled])')
      ?? options.root.value?.querySelector<HTMLElement>('[data-feedback-summary]')
    target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    target?.focus()
  }
  async function validate(values: Record<string, string>) {
    clear()
    errors.value = Object.fromEntries(Object.entries(values).filter(([field, message]) => options.fields()[field] && message))
    if (Object.keys(errors.value).length) { await focus(); return false }
    return true
  }
  async function capture(error: unknown) {
    clear()
    const failure = error as { response?: { data?: { fieldErrors?: unknown; message?: unknown; requestId?: unknown } }; requestId?: unknown; feedbackMessage?: string }
    const body = failure?.response?.data
    const id = failure?.requestId ?? body?.requestId
    if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)) requestId.value = id
    if (Array.isArray(body?.fieldErrors)) {
      for (const item of body.fieldErrors.slice(0, 100)) {
        if (!item || typeof item.path !== 'string' || typeof item.message !== 'string') continue
        if (Object.hasOwn(options.fields(), item.path)) errors.value[item.path] = [...new Set([errors.value[item.path], item.message].filter(Boolean))].join('；')
        else general.value.push(item.message)
      }
    }
    if (failure?.feedbackMessage) { errors.value = {}; general.value = [failure.feedbackMessage] }
    else if (!summary.value.length) general.value = [typeof body?.message === 'string' ? body.message : !failure?.response ? '未收到保存结果，请先核对记录后再重试，当前输入已保留。' : '保存失败，请稍后重试，当前输入已保留。']
    await focus()
  }
  watch(() => options.values?.(), (value, old) => {
    if (!value || !old) return
    for (const field of Object.keys(errors.value)) if (value[field] !== old[field]) delete errors.value[field]
  }, { deep: false })
  return { errors, summary, requestId, attrs, errorId: (field: string) => `${prefix}-${field}`, clear, focus, validate, capture }
}
