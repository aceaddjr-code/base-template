import { reactive, ref } from 'vue'

export function useCrudModal<T extends Record<string, any>>(opts: {
  formFactory: () => T
  createFn: (data: T) => Promise<any>
  updateFn: (id: number, data: T) => Promise<any>
  onSaved?: (data: any, mode: 'create' | 'update') => void
  /** 保存并继续时保留的字段（从新表单值中取，如 { orderId: form.orderId }） */
  keepOnSave?: (form: T) => Partial<T>
  createMessage?: string
  updateMessage?: string
  onError?: (error: unknown) => void | Promise<void>
}) {
  const modalVisible = ref(false)
  const modalLoading = ref(false)
  const editingId = ref<number | null>(null)

  /** 表单状态（formFactory 为唯一源；用 Record 规避 UnwrapRef 泛型展开问题） */
  const form = reactive<T>(opts.formFactory()) as T

  /** 重置为初始值；keep 字段保留（从当前 form 取值） */
  function resetForm(keep?: Partial<T>) {
    const saved = { ...(form as any) } as any
    Object.assign(form as any, opts.formFactory())
    if (keep) {
      for (const [k, v] of Object.entries(keep)) {
        if (v !== undefined) (form as any)[k] = v
      }
    }
    return saved
  }

  /** 新增（可带保留字段，如从列表带入的父键） */
  function openCreate(keep?: Partial<T>) {
    editingId.value = null
    resetForm(keep)
    modalVisible.value = true
  }

  /** 编辑：按 formFactory 重置后填充 record 中存在的字段 */
  function openEdit(record: any) {
    editingId.value = record?.id ?? null
    resetForm()
    if (record) {
      for (const k of Object.keys(opts.formFactory())) {
        if (record[k] !== undefined) (form as any)[k] = record[k]
      }
    }
    modalVisible.value = true
  }

  async function handleSave(): Promise<boolean> {
    if (modalLoading.value) return false
    modalLoading.value = true
    try {
      if (editingId.value) {
        await opts.updateFn(editingId.value, { ...form } as T)
        opts.onSaved?.({ ...form } as T, 'update')
        modalVisible.value = false
      } else {
        await opts.createFn({ ...form } as T)
        opts.onSaved?.({ ...form } as T, 'create')
        // 保存并继续：不关弹窗，重置表单连续录入（保留字段由 keepOnSave 决定）
        resetForm(opts.keepOnSave?.(form as T))
      }
      return true
    } catch (error) {
      await opts.onError?.(error)
      return false
    } finally {
      modalLoading.value = false
    }
  }

  return {
    modalVisible,
    modalLoading,
    editingId,
    form,
    openCreate,
    openEdit,
    handleSave,
    resetForm,
  }
}
