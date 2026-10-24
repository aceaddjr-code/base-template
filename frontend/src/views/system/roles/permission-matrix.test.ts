import { describe, expect, it } from 'vitest'
import { buildPermissionMatrix, collectSaveIds, isButtonNode, setRowsChecked, toggleButtonChecked, toggleFormChecked, type MatrixRow } from './permission-matrix'
import type { MenuItem } from '@/api/menu'

const button = (id: number, name: string, permission: string): MenuItem => ({ id, name, permission, type: 'button' }) as MenuItem
const menu = (id: number, name: string, children: MenuItem[] = [], type = 'menu'): MenuItem => ({ id, name, children, type } as MenuItem)

// 模块 1 → 表单 2（按钮 3=view、4=delete）+ 无按钮表单 5；模块 6 → 子目录 7 → 表单 8（按钮 9=view）
const tree = (): MenuItem[] => [
  menu(1, '系统管理', [menu(2, '用户管理', [button(3, '查看', 'user:view'), button(4, '删除', 'user:delete')]), menu(5, '无按钮页')]),
  menu(6, '业务模块', [menu(7, '子目录', [menu(8, '深层表单', [button(9, '查看', 'deep:view')])])]),
]

describe('权限矩阵纯逻辑', () => {
  it('isButtonNode：type=button 判定，缺 type 时按 permission 兜底', () => {
    expect(isButtonNode(button(3, '查看', 'user:view'))).toBe(true)
    expect(isButtonNode({ id: 10, name: '旧按钮', permission: 'x:y' } as MenuItem)).toBe(true)
    expect(isButtonNode(menu(11, '普通菜单'))).toBe(false)
    expect(isButtonNode({ id: 12, name: '无权限旧节点' } as MenuItem)).toBe(false)
  })

  it('buildPermissionMatrix：只收录带按钮的表单，模块可自身为表单，深层表单归属顶级模块', () => {
    const rows = buildPermissionMatrix(tree(), [2, 4, 8, 9])
    expect(rows.map((r) => r.formId)).toEqual([2, 8])
    expect(rows[0]).toMatchObject({ moduleId: 1, moduleName: '系统管理', checked: true })
    expect(rows[0]!.buttonChecked).toEqual({ 3: false, 4: true })
    expect(rows[1]).toMatchObject({ moduleId: 6, formId: 8, checked: true, buttonChecked: { 9: true } })
  })

  it('toggleFormChecked：关闭入口清空整行；开启入口只带出读取权限', () => {
    const [row] = buildPermissionMatrix(tree(), [2, 3, 4])
    toggleFormChecked(row, false)
    expect(row.checked).toBe(false)
    expect(row.buttonChecked).toEqual({ 3: false, 4: false })
    toggleFormChecked(row, true)
    expect(row.checked).toBe(true)
    expect(row.buttonChecked).toEqual({ 3: true, 4: false })
  })

  it('toggleButtonChecked：开启操作联动页面与读取；关闭读取联动关闭整行', () => {
    const [row] = buildPermissionMatrix(tree(), [])
    toggleButtonChecked(row, 4, true)
    expect(row.checked).toBe(true)
    expect(row.buttonChecked).toEqual({ 3: true, 4: true })
    toggleButtonChecked(row, 3, false)
    expect(row.checked).toBe(false)
    expect(row.buttonChecked).toEqual({ 3: false, 4: false })
  })

  it('setRowsChecked：视图内页面与按钮同步全选/清空', () => {
    const rows = buildPermissionMatrix(tree(), [])
    setRowsChecked(rows, true)
    expect(rows.every((r) => r.checked && Object.values(r.buttonChecked).every(Boolean))).toBe(true)
    setRowsChecked(rows.filter((r) => r.formId === 2), false)
    expect(rows[0]!.checked).toBe(false)
    expect(rows[1]!.checked).toBe(true)
  })

  it('collectSaveIds：保留未管理菜单防丢权限，收集勾选并补全祖先', () => {
    const rows = buildPermissionMatrix(tree(), [5])
    // 勾选深层表单 8 的查看按钮 9：应带出祖先 7 与模块 6；未管理菜单 5 原样保留
    toggleButtonChecked(rows.find((r) => r.formId === 8)!, 9, true)
    const ids = collectSaveIds(rows, [5], tree())
    // 未管理菜单 5 保留时其祖先模块 1 一并补全（与旧树保存行为一致）
    expect(new Set(ids)).toEqual(new Set([1, 5, 6, 7, 8, 9]))
    // 取消勾选后只剩未管理菜单及其祖先
    setRowsChecked(rows, false)
    expect(new Set(collectSaveIds(rows, [5], tree()))).toEqual(new Set([1, 5]))
  })

  it('collectSaveIds：全部清空且无未管理菜单时不提交任何 id', () => {
    const rows: MatrixRow[] = []
    expect(collectSaveIds(rows, [], tree())).toEqual([])
  })
})
