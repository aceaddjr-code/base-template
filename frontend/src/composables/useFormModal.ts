import { computed, reactive, ref } from 'vue'
import { useFormFeedback } from './useFormFeedback'
import { useUnsavedChanges } from './useUnsavedChanges'
import type { RouteLocationNormalized } from 'vue-router'

/** save 返回 'continue' 时保留弹窗并重置表单（连续录入），其余返回值关闭本次会话 */
export type FormModalSaveResult = 'continue' | void

/**
 * 表单弹窗状态机：打开（重置→拍基线→清反馈）、关闭（未保存确认）、提交（本地校验→保存→错误捕获）。
 * 加载锁四件套由 modalProps 统一承载（v-bind 到 a-modal）；查看↔编辑原地切换的抽屉把 visible 当编辑态用。
 * 反馈根节点以函数式 ref 绑定（如 <div :ref="bindRoot">）。
 */
export function useFormModal<TForm extends object, TId extends string | number = string | number>(options: {
  /** 字段标签：错误摘要显示与服务端字段错误映射共用 */
  fields: () => Record<string, string>
  /** 表单初始值工厂（打开与连续录入重置共用） */
  defaults: () => TForm
  /** 本地校验：返回 字段→错误（空值跳过）；省略时只依赖服务端校验 */
  validate?: (form: TForm, editId: TId | null) => Record<string, string | undefined> | Promise<Record<string, string | undefined>>
  /** 保存：调用方执行 API、成功提示与列表刷新；抛错时留在弹窗并捕获为字段/摘要反馈 */
  save: (form: TForm, editId: TId | null) => Promise<FormModalSaveResult>
  /** 未保存确认的附加激活门槛（如受控可见性 props.open）；最终按「门槛成立且会话进行中」判定 */
  active?: () => boolean
  /** 脏数据快照口径，默认整个表单 */
  snapshot?: (form: TForm) => unknown
  /** 会话结束（关闭或保存成功）后的回调，受控组件在此透传 update:open */
  onClosed?: () => void
  preserveNavigation?: (to: RouteLocationNormalized, from: RouteLocationNormalized) => boolean
}) {
  const visible = ref(false)
  const loading = ref(false)
  const editId = ref<TId | null>(null)
  const form = reactive(options.defaults()) as TForm
  const root = ref<HTMLElement | null>(null)
  /** 模板反馈根节点以函数式 ref 绑定：<div :ref="bindRoot"> */
  function bindRoot(el: unknown) { root.value = (el as HTMLElement | null) ?? null }
  const feedback = useFormFeedback({ root, fields: options.fields, values: () => ({ ...form }) as Record<string, unknown> })
  const snapshotOf = () => JSON.stringify(options.snapshot ? options.snapshot(form) : { ...form })
  let baseline = snapshotOf()
  const unsaved = useUnsavedChanges({
    active: () => (options.active ? options.active() && visible.value : visible.value),
    dirty: () => snapshotOf() !== baseline,
    saving: () => loading.value,
    preserveNavigation: options.preserveNavigation,
  })

  /** 重置为默认值（可带初始值）：先清残留键再赋值，支持字段集动态变化的表单（如详情抽屉按配置生成编辑字段） */
  function resetForm(values?: Partial<TForm>) {
    for (const key of Object.keys(form)) delete (form as Record<string, unknown>)[key]
    Object.assign(form, options.defaults(), values)
  }

  function open(id: TId | null = null, values?: Partial<TForm>) {
    resetForm(values)
    editId.value = id
    feedback.clear()
    baseline = snapshotOf()
    visible.value = true
  }

  function close() {
    void unsaved.attempt(() => { visible.value = false; feedback.clear(); options.onClosed?.() })
  }

  /** 未保存确认通过后执行任意动作（如编辑态抽屉的关闭透传） */
  function guard(action: () => void) {
    void unsaved.attempt(action)
  }

  async function submit() {
    if (loading.value) return
    const rawErrors = options.validate ? await options.validate(form, editId.value) : {}
    const localErrors = Object.fromEntries(Object.entries(rawErrors).filter(([, message]) => !!message)) as Record<string, string>
    if (!(await feedback.validate(localErrors))) return
    loading.value = true
    try {
      const result = await options.save(form, editId.value)
      if (result === 'continue') {
        resetForm()
        feedback.clear()
        baseline = snapshotOf()
      } else {
        visible.value = false
        feedback.clear()
        options.onClosed?.()
      }
    } catch (error) {
      await feedback.capture(error)
    } finally {
      loading.value = false
    }
  }

  const modalProps = computed(() => ({
    confirmLoading: loading.value,
    maskClosable: !loading.value,
    keyboard: !loading.value,
    closable: !loading.value,
    cancelButtonProps: { disabled: loading.value },
  }))

  return { visible, loading, editId, form, feedback, bindRoot, modalProps, open, close, guard, submit }
}
