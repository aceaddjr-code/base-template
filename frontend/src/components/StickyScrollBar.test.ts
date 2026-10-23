import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StickyScrollBar from './StickyScrollBar.vue'

describe('页脚横滚条与表格可滚动距离', () => {
  let wrapper: ReturnType<typeof mount> | undefined

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it.each([400, 600, 800])('页脚宽 %i 时仍能覆盖表格的全部横向范围', async barWidth => {
    const source = document.createElement('div')
    Object.defineProperties(source, {
      clientWidth: { value: 600 },
      scrollWidth: { value: 1200 },
    })
    wrapper = mount(StickyScrollBar, { props: { source: () => source } })
    Object.defineProperty(wrapper.element, 'clientWidth', { value: barWidth })
    await vi.advanceTimersByTimeAsync(300)

    const track = wrapper.get('.sticky-h-scroll-track').element as HTMLElement
    const footerRange = Number.parseFloat(track.style.width) - barWidth
    expect(footerRange).toBe(source.scrollWidth - source.clientWidth)
    const bar = wrapper.element as HTMLElement
    bar.scrollLeft = footerRange
    await wrapper.trigger('scroll')
    expect(source.scrollLeft).toBe(600)
  })

  it('表格没有横向溢出时不显示页脚滚动条', async () => {
    const source = document.createElement('div')
    Object.defineProperties(source, {
      clientWidth: { value: 600 },
      scrollWidth: { value: 600 },
    })
    wrapper = mount(StickyScrollBar, { props: { source: () => source } })
    await vi.advanceTimersByTimeAsync(300)
    expect((wrapper.element as HTMLElement).style.display).toBe('none')
  })
})
