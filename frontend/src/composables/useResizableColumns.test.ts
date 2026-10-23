import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useResizableColumns } from './useResizableColumns'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('列宽拖动', () => {
  it('松手产生的点击不会触发表头排序，后续正常点击仍可排序', () => {
    vi.useFakeTimers()
    const sort = vi.fn()
    const wrapper = mount(defineComponent({
      setup() {
        const { resizeStart } = useResizableColumns('resize-test', ref([{ key: 'title', width: 220 }]), { title: 220 })
        return () => h('div', { onClick: sort }, [h('span', {
          onMousedown: (event: MouseEvent) => resizeStart('title', event),
        })])
      },
    }), { attachTo: document.body })
    try {
      wrapper.find('span').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 220 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }))
      document.dispatchEvent(new MouseEvent('mouseup'))
      // 松手时鼠标可能已离开手柄，浏览器在共同父容器上产生 click。
      wrapper.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(sort).not.toHaveBeenCalled()
      vi.runAllTimers()
      wrapper.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(sort).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem('resize-test')!)).toEqual({ title: 260 })
    } finally {
      wrapper.unmount()
    }
  })

  it('拖动中离开页面后恢复文字选择并移除点击拦截', () => {
    const wrapper = mount(defineComponent({
      setup() {
        const { resizeStart } = useResizableColumns('resize-unmount', ref([{ key: 'title' }]))
        return () => h('span', { onMousedown: (event: MouseEvent) => resizeStart('title', event) })
      },
    }), { attachTo: document.body })
    wrapper.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.body.style.userSelect).toBe('none')
    wrapper.unmount()
    expect(document.body.style.userSelect).toBe('')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })
})
