import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import HelpPage from './index.vue'
import { HELP_SECTIONS, PAGE_HELP } from '@/content/help'

const Pass = { template: '<div />' }

async function makeRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/help', component: HelpPage },
      { path: '/:pathMatch(.*)*', component: Pass },
    ],
  })
  await router.push(initialPath)
  await router.isReady()
  return router
}

describe('帮助中心（F22）', () => {
  it('渲染全部小节与目录，内容来自内置 Markdown', async () => {
    const wrapper = mount(HelpPage, { global: { plugins: [await makeRouter('/help')] }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    for (const section of HELP_SECTIONS) {
      expect(wrapper.find(`[data-section="${section.id}"]`).exists()).toBe(true)
      expect(wrapper.text()).toContain(section.title)
    }
    // 更新记录的日期条目可见（真实内容而非空壳）
    expect(wrapper.text()).toContain('2026-10-23')
    wrapper.unmount()
  })

  it('带 from 参数时展示当前页面关联并定位到对应标题', async () => {
    const entry = PAGE_HELP.find((item) => item.route === '/examples/items')!
    const wrapper = mount(HelpPage, { global: { plugins: [await makeRouter('/help?from=/examples/items')] }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    const banner = wrapper.find('.from-banner')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain(entry.heading)
    // 点击“查看相关说明”后在对应小节内高亮标题（测试环境 a-button 可能不渲染真实 button 元素）
    const action = banner.find('button').exists() ? banner.find('button') : banner.find('a-button')
    await action.trigger('click')
    await wrapper.vm.$nextTick()
    const section = wrapper.find('[data-section="pages"]')
    const targets = section.findAll('.is-target')
    expect(targets.length).toBe(1)
    expect(targets[0].text()).toBe(entry.heading)
    wrapper.unmount()
  })

  it('无关的 from 路径不显示关联条', async () => {
    const wrapper = mount(HelpPage, { global: { plugins: [await makeRouter('/help?from=/no-such-page')] }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.from-banner').exists()).toBe(false)
    wrapper.unmount()
  })

  it('按页映射的路由都指向已存在的小节标题', () => {
    for (const entry of PAGE_HELP) {
      const section = HELP_SECTIONS.find((item) => item.id === entry.sectionId)
      expect(section, `${entry.route} 的小节存在`).toBeTruthy()
      expect(section!.markdown).toContain(`## ${entry.heading}`)
    }
  })
})
