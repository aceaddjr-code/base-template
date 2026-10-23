import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ColumnPanel from './ColumnPanel.vue'
import { useColumnConfig } from '@/composables/useColumnConfig'
import { useResizableColumns } from '@/composables/useResizableColumns'

const KEY = 'starter-column-panel-test'
const allCols = [
  { key: 'a', title: '甲', width: 200 },
  { key: 'b', title: '乙', width: 120 },
  { key: 'action', title: '操作', fixed: 'right' },
]

beforeEach(() => { localStorage.clear() })

function mountPanel(options: { withWidths?: boolean } = {}) {
  let preferences: ReturnType<typeof useColumnConfig> | undefined
  let resizable: ReturnType<typeof useResizableColumns> | undefined
  const applySpy = vi.fn()
  const columns = ref(allCols.map((c) => ({ ...c })))
  const Harness = defineComponent({
    setup() {
      preferences = useColumnConfig(KEY, columns)
      if (options.withWidths) {
        resizable = useResizableColumns(KEY + '-width', columns, { a: 200, b: 120 })
      }
      return () => h(ColumnPanel, {
        preferences: preferences!,
        widths: options.withWidths && resizable
          ? { values: resizable.colWidths, apply: (key: string, width: number) => { applySpy(key, width); resizable!.setColumnWidth(key, width) } }
          : undefined,
      })
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, preferences: preferences!, applySpy }
}

describe('列设置面板的非拖拽排序（F35）', () => {
  it('上移/下移按钮调整顺序，操作列锁尾不参与', async () => {
    const { wrapper, preferences } = mountPanel()
    const keys = () => preferences.fields.value.map((f) => f.key)
    const moveBtn = (label: string) => wrapper.find(`[aria-label="${label}"]`)
    const clickUntil = async (label: string, expected: string[]) => {
      await moveBtn(label).trigger('click')
      await vi.waitFor(() => expect(keys()).toEqual(expected))
    }
    expect(keys()).toEqual(['a', 'b', 'action'])
    await clickUntil('下移甲', ['b', 'a', 'action'])
    // 乙下移会撞到锁定列,按钮禁用,顺序不变
    expect(moveBtn('下移乙').attributes('disabled')).toBeDefined()
    await clickUntil('上移甲', ['a', 'b', 'action'])
    wrapper.unmount()
  })
})

describe('列设置面板的宽度编辑（F35）', () => {
  it('传入 widths 时每行显示宽度编辑入口', () => {
    const { wrapper } = mountPanel({ withWidths: true })
    expect(wrapper.find('[aria-label="甲列宽"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="乙列宽"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('未传 widths 时不显示宽度编辑框', () => {
    const { wrapper } = mountPanel()
    expect(wrapper.find('[aria-label="甲列宽"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('useResizableColumns.setColumnWidth（F35）', () => {
  it('改宽落盘并同步列对象，越界忽略', () => {
    let exposed: ReturnType<typeof useResizableColumns> | undefined
    const columns = ref([{ key: 'a', width: 200 }, { key: 'b' }])
    const wrapper = mount(defineComponent({
      setup() {
        exposed = useResizableColumns('resize-set-width-test', columns, { a: 200 })
        return () => h('div')
      },
    }))
    try {
      exposed!.setColumnWidth('a', 300)
      expect(columns.value[0]!.width).toBe(300)
      expect(JSON.parse(localStorage.getItem('resize-set-width-test')!)).toEqual({ a: 300 })
      exposed!.setColumnWidth('a', 20)
      expect(columns.value[0]!.width).toBe(300)
    } finally { wrapper.unmount() }
  })
})
