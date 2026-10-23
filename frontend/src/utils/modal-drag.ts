

let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let currentModal: HTMLElement | null = null

/** 解析元素当前 transform matrix 的 translateX/Y（无 transform 返回 0） */
function parseTranslate(el: HTMLElement): { x: number; y: number } {
  const m = getComputedStyle(el).transform
  if (!m || m === 'none') return { x: 0, y: 0 }
  const parts = m.match(/matrix\(([^)]+)\)/)
  if (!parts) return { x: 0, y: 0 }
  const nums = parts[1].split(',').map((s) => parseFloat(s.trim()))
  return { x: nums[4] || 0, y: nums[5] || 0 }
}

function onMouseDown(e: MouseEvent) {
  // 只处理左键
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (!target.closest) return
  const modal = target.closest('.ant-modal') as HTMLElement | null
  if (!modal) return
  // 防御：关闭后残留的隐藏 modal 不应可拖
  if (modal.getClientRects().length === 0 || getComputedStyle(modal).display === 'none') return
  // 只拖 modal 顶部条带（标题栏 24px + content 顶部留白 ≈ 40px）——
  const rect = modal.getBoundingClientRect()
  if (e.clientY - rect.top > 40) return
  if (target.closest('.ant-modal-close')) return // 关闭按钮点击不触发拖拽
  // 排除输入类/按钮/链接（防误拖内容区交互元素）
  if (target.closest('input, textarea, select, button, a')) return

  dragging = true
  currentModal = modal
  startX = e.clientX
  startY = e.clientY
  const t = parseTranslate(modal)
  originX = t.x
  originY = t.y
  modal.style.willChange = 'transform'
  e.preventDefault() // 防标题文字选中
  document.body.style.userSelect = 'none'

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!dragging || !currentModal) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = currentModal.offsetWidth
  // 边界约束：可自由拖拽（含往上拖出视口顶部一部分），但保留抓回空间——
  // 顶部最多出视口 80px（标题栏可抓回），左右各留 80px，底部保留 40px 标题可抓
  const dx = Math.min(Math.max(originX + (e.clientX - startX), -w + 80), vw - 80)
  const dy = Math.min(Math.max(originY + (e.clientY - startY), -80), vh - 40)
  currentModal.style.transform = `translate(${dx}px, ${dy}px)`
}

function onMouseUp() {
  if (!dragging || !currentModal) return
  dragging = false
  currentModal.style.willChange = ''
  currentModal = null
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

/** 全站启用弹窗拖拽（app 挂载后调用一次） */
export function initModalDrag(): void {
  document.addEventListener('mousedown', onMouseDown, true)
}
