import { describe, expect, it } from 'vitest'
import { collectOrgKeys, orgTreeHasKey, searchOrgTree, splitHighlight } from './org-tree-search'

/** 公司 ─ 研发部 ─ 前端组；公司 ─ 销售部 ─ 市场组 */
function tree() {
  return [
    {
      key: 'all', name: '全部成员', children: [
        {
          key: 'dept-1', name: '总公司', code: 'D1', children: [
            { key: 'dept-2', name: '研发部', code: 'D2', children: [{ key: 'dept-3', name: '前端组', code: 'D3' }] },
            { key: 'dept-4', name: '销售部', code: 'D4', children: [{ key: 'dept-5', name: '市场组', code: 'D5' }] },
          ],
        },
      ],
    },
  ]
}

function keys(nodes: any[]): string[] {
  return nodes.flatMap((n) => (n.children?.length ? [n.key, ...keys(n.children)] : [n.key]))
}

describe('searchOrgTree', () => {
  it('只命中叶子部门时祖先链完整保留', () => {
    const { visible, expandKeys } = searchOrgTree(tree(), '前端')
    expect(keys(visible)).toEqual(['all', 'dept-1', 'dept-2', 'dept-3'])
    expect(expandKeys).toEqual(['all', 'dept-1', 'dept-2'])
  })

  it('多个分支各自命中时互不丢失', () => {
    const { visible } = searchOrgTree(tree(), '组')
    expect(keys(visible)).toEqual(['all', 'dept-1', 'dept-2', 'dept-3', 'dept-4', 'dept-5'])
  })

  it('命中节点的未命中子树按口径裁剪', () => {
    const { visible } = searchOrgTree(tree(), '研发部')
    const rd = visible[0]!.children![0]!.children![0]!
    expect(rd.name).toBe('研发部')
    expect(rd.children).toEqual([])
  })

  it('按编码命中且大小写不敏感', () => {
    const { visible } = searchOrgTree(tree(), 'd5')
    expect(keys(visible)).toEqual(['all', 'dept-1', 'dept-4', 'dept-5'])
  })

  it('无命中返回空树', () => {
    const { visible, expandKeys } = searchOrgTree(tree(), '财务')
    expect(visible).toEqual([])
    expect(expandKeys).toEqual([])
  })

  it('无关键词原样返回', () => {
    const nodes = tree()
    expect(searchOrgTree(nodes, '  ').visible).toBe(nodes)
  })
})

describe('collectOrgKeys / orgTreeHasKey', () => {
  it('收集含根的全部 key', () => {
    expect(collectOrgKeys(tree())).toEqual(['all', 'dept-1', 'dept-2', 'dept-3', 'dept-4', 'dept-5'])
  })

  it('判断 key 是否在可见树中', () => {
    const { visible } = searchOrgTree(tree(), '前端')
    expect(orgTreeHasKey(visible, 'dept-3')).toBe(true)
    expect(orgTreeHasKey(visible, 'dept-5')).toBe(false)
  })
})

describe('splitHighlight', () => {
  it('标记命中段，大小写不敏感', () => {
    expect(splitHighlight('研发部 ABC', 'abc')).toEqual([{ text: '研发部 ', hit: false }, { text: 'ABC', hit: true }])
  })

  it('多段命中全部标记', () => {
    expect(splitHighlight('a-b-a', 'a')).toEqual([
      { text: 'a', hit: true }, { text: '-b-', hit: false }, { text: 'a', hit: true },
    ])
  })

  it('无命中与空关键词返回整段未命中', () => {
    expect(splitHighlight('研发部', 'xyz')).toEqual([{ text: '研发部', hit: false }])
    expect(splitHighlight('研发部', '')).toEqual([{ text: '研发部', hit: false }])
  })
})
