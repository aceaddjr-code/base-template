import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExampleHistoryPanel from './ExampleHistoryPanel.vue'
import { getExampleHistory, type ExampleEvent, type HistoryResult } from '@/api/example'
vi.mock('@/api/example', () => ({ getExampleHistory: vi.fn() }))
const Button = defineComponent({ props: ['disabled', 'htmlType'], emits: ['click'], setup(props, { slots, emit }) { return () => h('button', { disabled: props.disabled, type: props.htmlType || 'button', onClick: () => emit('click') }, slots.default?.()) } })
const event = (id: number, title: string): ExampleEvent => ({ id, itemId: 1, action: 'update', result: 'success', actorId: 7, actorName: '操作人', occurredAt: '2026-10-26T01:00:00.000Z', objectLabel: title, source: 'web', version: 2, batchId: null, rowNumber: null })
const result = (list: ExampleEvent[], cursor: string | null = null): HistoryResult => ({ list, total: list.length, upper: 99, nextCursor: cursor, notice: '历史未记录' })
const setup = (tab: 'activity' | 'operations' | 'changes' = 'activity') => mount(ExampleHistoryPanel, { props: { recordId: 1, tab, revision: 0 }, global: { stubs: { AButton: Button } } })
beforeEach(() => vi.resetAllMocks())
describe('单据履历外部行为', () => {
 it('按操作人姓名查询并可重置', async () => {
  vi.mocked(getExampleHistory).mockResolvedValue(result([]))
  const wrapper = setup(); await flushPromises()
  await wrapper.get('input[type="text"]').setValue('操作人')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(vi.mocked(getExampleHistory).mock.lastCall![2]).toMatchObject({ actorName: '操作人' })
  await wrapper.findAll('button').find(b => b.text() === '重置')!.trigger('click'); await flushPromises()
  expect(vi.mocked(getExampleHistory).mock.lastCall![2]).not.toHaveProperty('actorName')
  wrapper.unmount()
 })
 it('标题变更时显示前后值，其他修改只显示单据标题', async () => {
  const changed = event(2, '新标题')
  changed.changes = [{ id: 1, fieldKey: 'title', fieldLabel: '标题', valueType: 'text', beforeValue: '旧标题', afterValue: '新标题', beforeLabel: null, afterLabel: null }]
  const unchanged = event(1, '原标题'); unchanged.changes = []
  vi.mocked(getExampleHistory).mockResolvedValue(result([changed, unchanged]))
  const wrapper = setup(); await flushPromises()
  const cards = wrapper.findAll('article')
  expect(cards[0]!.text()).toContain('旧标题 → 新标题')
  expect(cards[1]!.text()).toContain('原标题'); expect(cards[1]!.text()).not.toContain('→')
  wrapper.unmount()
 })
 it('快速切换记录时忽略旧响应，加载、失败与空态可区分并能独立重试', async () => {
  let finish!: (data: HistoryResult) => void
  vi.mocked(getExampleHistory).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockRejectedValueOnce(new Error('offline'))
  const wrapper = setup()
  expect(wrapper.text()).toContain('正在加载')
  await wrapper.setProps({ recordId: 2 }); await flushPromises()
  finish(result([event(1, '旧单据')]))
  await flushPromises(); expect(wrapper.text()).not.toContain('旧单据'); expect(wrapper.text()).toContain('履历加载失败'); expect(wrapper.text()).not.toContain('暂无已记录')
  vi.mocked(getExampleHistory).mockResolvedValue(result([]))
  await wrapper.findAll('button').find(b => b.text() === '重试')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('暂无已记录动态'); expect(wrapper.text()).not.toContain('履历加载失败')
  wrapper.unmount()
 })
 it('连续加载失败保留当前内容，重试同一游标不重复当前批；查询重置上界', async () => {
  vi.mocked(getExampleHistory).mockResolvedValueOnce(result([event(3, '第一批')], 'cursor-1')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result([event(2, '第二批')]))
  const wrapper = setup(); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '加载更多')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('第一批'); expect(wrapper.text()).toContain('履历加载失败')
  await wrapper.findAll('button').find(b => b.text() === '重试')!.trigger('click'); await flushPromises()
  expect(wrapper.findAll('article')).toHaveLength(2); expect(wrapper.text()).toContain('第二批')
  expect(vi.mocked(getExampleHistory).mock.calls[2]![2]).toMatchObject({ cursor: 'cursor-1', upper: 99 })
  vi.mocked(getExampleHistory).mockResolvedValue(result([])); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(vi.mocked(getExampleHistory).mock.lastCall![2]).not.toHaveProperty('upper'); wrapper.unmount()
 })
 it('定位修改清除旧筛选，零、否、空和未知值区分，长文本可展开', async () => {
  const item = event(8, '字段展示')
  item.changes = [0, false, null, undefined, '长'.repeat(150)].map((value, id) => ({ id, fieldKey: String(id), fieldLabel: `字段${id}`, valueType: 'text', beforeValue: value, afterValue: '新值', beforeLabel: null, afterLabel: null }))
  vi.mocked(getExampleHistory).mockResolvedValue(result([item]))
  const wrapper = setup('changes'); await flushPromises()
  expect(wrapper.text()).toContain('否'); expect(wrapper.text()).toContain('未填写'); expect(wrapper.text()).toContain('历史未记录'); expect(wrapper.find('details').exists()).toBe(true)
  await wrapper.get('select').setValue('print'); await wrapper.setProps({ eventId: 8 }); await flushPromises()
  expect(vi.mocked(getExampleHistory).mock.lastCall![2]).toMatchObject({ eventId: 8 }); expect(vi.mocked(getExampleHistory).mock.lastCall![2]).not.toHaveProperty('action')
  wrapper.unmount()
 })
})
