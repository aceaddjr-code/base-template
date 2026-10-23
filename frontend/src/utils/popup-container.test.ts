import { describe, expect, it } from 'vitest'
import { getDrawerAwarePopupContainer } from './popup-container'

describe('getDrawerAwarePopupContainer', () => {
  it('移动端抽屉中的选择浮层挂载在当前抽屉内容层', () => {
    const drawer = document.createElement('div')
    drawer.className = 'ant-drawer-content'
    const trigger = document.createElement('div')
    drawer.appendChild(trigger)
    document.body.appendChild(drawer)

    expect(getDrawerAwarePopupContainer(trigger)).toBe(drawer)
    drawer.remove()
  })

  it('普通页面浮层仍挂载到 body', () => {
    const trigger = document.createElement('div')
    document.body.appendChild(trigger)

    expect(getDrawerAwarePopupContainer(trigger)).toBe(document.body)
    trigger.remove()
  })
})
