/**
 * F22 帮助中心的迷你 Markdown 渲染器。
 * 内容虽然来自代码库（可信来源），仍按「先整体转义、再按白名单转换」实现，
 * 输出不含任何调用方传入的原始 HTML；支持子集：##/### 标题、- 与 1. 列表、
 * **粗体**、`行内代码`、[文本](链接)、> 引用、空行分段。
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // 仅接受 http(s)、相对路径与锚点链接；其余协议原样显示为文本
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (/^(https?:\/\/|\/|#)/.test(href)) {
      const external = /^https?:\/\//.test(href)
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
    }
    return match
  })
  return out
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) { html.push(`<p>${renderInline(paragraph.join(' '))}</p>`); paragraph = [] }
  }
  const flushList = () => {
    if (list) { html.push(`<${list.type}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${list.type}>`); list = null }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      flushParagraph(); flushList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) { flushParagraph(); flushList(); html.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`); continue }
    const unordered = line.match(/^[-*]\s+(.*)$/)
    if (unordered) { flushParagraph(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } } list.items.push(unordered[1]); continue }
    const ordered = line.match(/^\d+[.、]\s+(.*)$/)
    if (ordered) { flushParagraph(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } } list.items.push(ordered[1]); continue }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph(); flushList()
  return html.join('\n')
}

/** 从渲染结果中提取标题结构，用于目录/锚点定位（heading 文本原样返回） */
export function extractHeadings(markdown: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^(#{2,4})\s+(.+)$/)
    if (match) headings.push({ level: match[1].length, text: match[2].trim() })
  }
  return headings
}
