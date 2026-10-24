import type { MenuItem } from '@/api/menu'

/**
 * 角色权限矩阵的纯逻辑：构建、勾选联动与保存收集。
 * 不持有状态，全部由调用方传入菜单树、已分配 id 与矩阵行，便于单测直穿。
 */

export interface MatrixButton {
  id: number
  name: string
  permission?: string | null
}

export interface MatrixRow {
  formId: number
  formName: string
  moduleId: number
  moduleName: string
  buttons: MatrixButton[]
  /** 页面入口的可见性 */
  checked: boolean
  buttonChecked: Record<number, boolean>
}

/** 按钮节点判定：type='button'；树缺 type 字段时以「有 permission 字段」兜底 */
export function isButtonNode(node: MenuItem): boolean {
  return node.type === 'button' || (node.type == null && !!node.permission)
}

/** 由全量菜单树 + 角色已分配菜单 id 构建矩阵行（只收录带按钮节点的表单，模块自身也可为表单） */
export function buildPermissionMatrix(moduleTree: MenuItem[], existingIds: number[]): MatrixRow[] {
  const rows: MatrixRow[] = []
  const pushRow = (node: MenuItem, moduleId: number, moduleName: string) => {
    const buttons = (node.children ?? []).filter(isButtonNode)
    if (buttons.length === 0) return
    rows.push({
      formId: node.id,
      formName: node.name,
      moduleId,
      moduleName,
      buttons: buttons.map((b) => ({ id: b.id, name: b.name, permission: b.permission })),
      checked: existingIds.includes(node.id),
      buttonChecked: Object.fromEntries(buttons.map((b) => [b.id, existingIds.includes(b.id)])),
    })
  }
  const walk = (nodes: MenuItem[], moduleId: number, moduleName: string) => {
    for (const node of nodes) {
      pushRow(node, moduleId, moduleName)
      const subMenus = (node.children ?? []).filter((c) => !isButtonNode(c))
      if (subMenus.length) walk(subMenus, moduleId, moduleName)
    }
  }
  for (const mod of moduleTree) {
    pushRow(mod, mod.id, mod.name)
    walk(mod.children ?? [], mod.id, mod.name)
  }
  return rows
}

/** 页面入口联动读取权限，关闭入口时清除该行操作权限（原地修改行） */
export function toggleFormChecked(row: MatrixRow, checked: boolean): void {
  row.checked = checked
  for (const b of row.buttons) {
    if (!checked || b.permission?.endsWith(':view')) row.buttonChecked[b.id] = checked
  }
}

/** 启用操作时同时启用页面和读取权限；关闭读取权限时联动关闭整个页面入口 */
export function toggleButtonChecked(row: MatrixRow, buttonId: number, checked: boolean): void {
  row.buttonChecked[buttonId] = checked
  if (checked) {
    row.checked = true
    for (const b of row.buttons) if (b.permission?.endsWith(':view')) row.buttonChecked[b.id] = true
  } else if (row.buttons.find((b) => b.id === buttonId)?.permission?.endsWith(':view')) {
    toggleFormChecked(row, false)
  }
}

/** 全选/清空当前视图行：页面入口与全部按钮同步（原地修改行） */
export function setRowsChecked(rows: MatrixRow[], checked: boolean): void {
  for (const row of rows) {
    toggleFormChecked(row, checked)
    for (const button of row.buttons) row.buttonChecked[button.id] = checked
  }
}

/**
 * 收集保存 id：
 * 1. 保留矩阵未管理的菜单（未配置按钮的页面等），防全量替换丢权限；
 * 2. 矩阵勾选：页面入口（菜单 id）+ 按钮节点 id；
 * 3. 补全祖先（表单→模块），与旧树保存行为一致（后端侧边栏亦自动补父）。
 */
export function collectSaveIds(matrix: MatrixRow[], existingIds: number[], moduleTree: MenuItem[]): number[] {
  const managed = new Set<number>()
  for (const row of matrix) {
    managed.add(row.formId)
    for (const b of row.buttons) managed.add(b.id)
  }
  const ids = new Set<number>()
  for (const id of existingIds) {
    if (!managed.has(id)) ids.add(id)
  }
  for (const row of matrix) {
    if (row.checked) ids.add(row.formId)
    for (const b of row.buttons) {
      if (row.buttonChecked[b.id]) ids.add(b.id)
    }
  }
  const parentMap = new Map<number, number>()
  const walk = (nodes: MenuItem[], parentId: number | null) => {
    for (const n of nodes) {
      if (parentId != null) parentMap.set(n.id, parentId)
      if (n.children?.length) walk(n.children, n.id)
    }
  }
  walk(moduleTree, null)
  const withAncestors = new Set<number>()
  for (const id of ids) {
    let cur: number | undefined = id
    let guard = 0
    while (cur != null && guard < 20) {
      withAncestors.add(cur)
      cur = parentMap.get(cur)
      guard += 1
    }
  }
  return [...withAncestors]
}
