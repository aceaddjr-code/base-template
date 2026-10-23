/**
 * 浮层在抽屉内触发时挂到当前抽屉，避免全局 zoom 与移动端反缩放叠加后
 * Select/Picker/Popover 被定位到可视区之外。普通页面仍沿用 body。
 */
export function getDrawerAwarePopupContainer(triggerNode?: HTMLElement): HTMLElement {
  const drawerContent = triggerNode?.closest('.ant-drawer-content')
  return drawerContent instanceof HTMLElement ? drawerContent : document.body
}
