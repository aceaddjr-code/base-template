import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * 计算表格 body 的可视高度：容器高度 - 工具栏 - 表头。
 * 配合 antd 的 scroll.y 使用，表头由 antd 单独渲染并固定，body 内部滚动。
 * 工具栏在窄屏会换行，所以用 ResizeObserver 跟随，而不是写死 calc。
 */
export function useTableScrollY(container: Ref<HTMLElement | null>) {
  const y = ref(0)
  let observer: ResizeObserver | null = null
  let mutation: MutationObserver | undefined

  function measure() {
    const el = container.value
    if (!el) return
    const header = el.querySelector<HTMLElement>('.ant-table-thead')
    const controls = Array.from(el.children).filter(child => !child.classList.contains('ant-table-wrapper')) as HTMLElement[]
    const used = controls.reduce((height, child) => height + child.getBoundingClientRect().height + parseFloat(getComputedStyle(child).marginTop || '0') + parseFloat(getComputedStyle(child).marginBottom || '0'), 0) + (header?.offsetHeight ?? 0)
    y.value = Math.max(120, Math.floor(el.clientHeight - used))
  }

  onMounted(() => {
    measure()
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => measure())
    if (container.value) observer.observe(container.value)
    const observeControls = () => {
      observer?.disconnect()
      if (container.value) observer?.observe(container.value)
      for (const child of Array.from(container.value?.children ?? [])) {
        if (!child.classList.contains('ant-table-wrapper')) observer?.observe(child)
      }
      const header = container.value?.querySelector('.ant-table-thead')
      if (header) observer?.observe(header)
      measure()
    }
    observeControls()
    mutation = new MutationObserver(observeControls)
    if (container.value) mutation.observe(container.value, { childList: true })
  })

  onBeforeUnmount(() => { observer?.disconnect(); mutation?.disconnect() })

  return y
}
