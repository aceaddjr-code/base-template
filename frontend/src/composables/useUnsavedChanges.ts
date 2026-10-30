import { inject, onBeforeUnmount, onMounted } from 'vue'
import { routerKey } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { Modal } from 'ant-design-vue'

/** 确认只影响导航/关闭，不保存表单，也不把密码等内容写入浏览器存储。 */
export function useUnsavedChanges(options: { active: () => boolean; dirty: () => boolean; saving: () => boolean; preserveNavigation?: (to: RouteLocationNormalized, from: RouteLocationNormalized) => boolean }) {
  const router = inject(routerKey, undefined)
  let pending: Promise<boolean> | undefined
  let cancelPending: (() => void) | undefined
  let disposed = false
  async function canLeave(): Promise<boolean> {
    if (disposed) return false
    if (!options.active()) return true
    if (options.saving()) return false
    if (!options.dirty()) return true
    if (pending) return pending
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pending = new Promise<boolean>(resolve => {
      let accepted = false
      const dialog = Modal.confirm({
        title: '有未保存的内容', content: '离开后本次输入将被丢弃。', okText: '放弃修改', cancelText: '继续编辑',
        onOk: () => { accepted = true; resolve(true) }, onCancel: () => resolve(false),
        afterClose: () => { if (!accepted && trigger?.isConnected) trigger.focus() },
      })
      cancelPending = () => { dialog.destroy(); resolve(false) }
    }).finally(() => { pending = undefined; cancelPending = undefined })
    return pending
  }
  async function attempt(action: () => void | Promise<void>) {
    if (await canLeave() && !disposed && !options.saving()) await action()
  }
  const stopNavigationGuard = router?.beforeEach((to, from) => to.fullPath === from.fullPath || options.preserveNavigation?.(to, from) ? true : canLeave())
  function beforeUnload(event: BeforeUnloadEvent) {
    if (options.active() && (options.dirty() || options.saving())) { event.preventDefault(); event.returnValue = '' }
  }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => { disposed = true; stopNavigationGuard?.(); window.removeEventListener('beforeunload', beforeUnload); cancelPending?.() })
  return { attempt, canLeave }
}
