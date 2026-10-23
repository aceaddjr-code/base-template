/**
 * 用户页组织架构树搜索：页面局部逻辑（目前仅用户页一个调用方，不上升为公共 composable）。
 * 树数据是全量启用部门（非懒加载），因此直接在客户端过滤，保证是全树搜索。
 * 搜索口径与后端 /departments?keyword= 一致：命中节点 + 祖先链；命中节点未命中的子树裁剪。
 */

export interface OrgSearchNode {
  key: string
  name: string
  code?: string
  children?: OrgSearchNode[]
}

export interface OrgSearchResult {
  /** 命中节点 + 祖先链组成的可见树；无关键词时原样返回 */
  visible: OrgSearchNode[]
  /** 搜索态下需要自动展开的祖先 key（可见树中拥有保留子节点的节点）；无关键词时为空 */
  expandKeys: string[]
}

function matches(node: OrgSearchNode, kw: string): boolean {
  return node.name.toLowerCase().includes(kw) || (!!node.code && node.code.toLowerCase().includes(kw))
}

export function searchOrgTree(nodes: OrgSearchNode[], keyword: string): OrgSearchResult {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return { visible: nodes, expandKeys: [] }
  const visible: OrgSearchNode[] = []
  const expandKeys: string[] = []
  for (const node of nodes) {
    const child = node.children?.length ? searchOrgTree(node.children, kw) : null
    if (child && child.visible.length) {
      expandKeys.push(node.key, ...child.expandKeys)
      visible.push({ ...node, children: child.visible })
    } else if (matches(node, kw)) {
      visible.push({ ...node, children: node.children ? [] : undefined })
    }
  }
  return { visible, expandKeys }
}

/** 全部节点 key（含根），用于恢复默认全展开 */
export function collectOrgKeys(nodes: OrgSearchNode[]): string[] {
  const keys: string[] = []
  const walk = (list: OrgSearchNode[]) => {
    for (const n of list) {
      keys.push(n.key)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return keys
}

export function orgTreeHasKey(nodes: OrgSearchNode[], key: string): boolean {
  for (const n of nodes) {
    if (n.key === key) return true
    if (n.children?.length && orgTreeHasKey(n.children, key)) return true
  }
  return false
}

export interface HighlightSegment {
  text: string
  hit: boolean
}

/** 按关键词切分文本用于命中高亮；大小写不敏感，多段命中全部标记 */
export function splitHighlight(text: string, keyword: string): HighlightSegment[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return [{ text, hit: false }]
  const segments: HighlightSegment[] = []
  let rest = text
  while (rest) {
    const index = rest.toLowerCase().indexOf(kw)
    if (index < 0) {
      segments.push({ text: rest, hit: false })
      break
    }
    if (index > 0) segments.push({ text: rest.slice(0, index), hit: false })
    segments.push({ text: rest.slice(index, index + kw.length), hit: true })
    rest = rest.slice(index + kw.length)
  }
  return segments
}
