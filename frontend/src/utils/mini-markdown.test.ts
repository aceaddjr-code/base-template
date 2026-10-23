import { describe, expect, it } from 'vitest'
import { extractHeadings, renderMarkdown } from './mini-markdown'

describe('F22 迷你 Markdown 渲染器', () => {
  it('标题、列表与分段转换为白名单标签', () => {
    const html = renderMarkdown('## 标题A\n\n第一段。\n\n- 项目一\n- 项目二\n\n1. 步骤一\n2. 步骤二')
    expect(html).toContain('<h2>标题A</h2>')
    expect(html).toContain('<p>第一段。</p>')
    expect(html).toContain('<ul><li>项目一</li><li>项目二</li></ul>')
    expect(html).toContain('<ol><li>步骤一</li><li>步骤二</li></ol>')
    expect(html).not.toContain('<h1')
  })

  it('行内粗体与代码按白名单转换', () => {
    const html = renderMarkdown('使用 **Ctrl** + `K` 打开搜索')
    expect(html).toContain('<strong>Ctrl</strong>')
    expect(html).toContain('<code>K</code>')
  })

  it('链接仅接受 http(s)、相对路径与锚点，并给外链加 noopener', () => {
    const html = renderMarkdown('[官网](https://example.com) [相对](/help) [锚点](#faq) [坏协议](javascript:alert(1))')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">官网</a>')
    expect(html).toContain('<a href="/help">相对</a>')
    expect(html).toContain('<a href="#faq">锚点</a>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('坏协议')
  })

  it('原始 HTML 一律转义，不产生可执行标记', () => {
    const html = renderMarkdown('你好 <script>alert(1)</script> 与 <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('引用块独立成段', () => {
    const html = renderMarkdown('> 提示内容')
    expect(html).toContain('<blockquote><p>提示内容</p></blockquote>')
  })

  it('extractHeadings 提取标题层级与文本', () => {
    const headings = extractHeadings('## 一级\n正文\n### 二级')
    expect(headings).toEqual([{ level: 2, text: '一级' }, { level: 3, text: '二级' }])
  })
})
