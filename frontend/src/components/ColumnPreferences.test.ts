import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ColumnSettings from './ColumnSettings.vue'
import PageToolbar from './PageToolbar.vue'

const KEY = 'starter-column-adapter-test'
const Dropdown = defineComponent({ setup(_, { slots }) { return () => h('div', [slots.default?.(), slots.overlay?.()]) } })
const Checkbox = defineComponent({
  props: { checked: Boolean, disabled: Boolean }, emits: ['change'],
  setup(props, { slots, emit }) {
    return () => h('label', [h('input', {
      type: 'checkbox', checked: props.checked, disabled: props.disabled,
      onChange: (event: Event) => emit('change', { target: { checked: (event.target as HTMLInputElement).checked } }),
    }), slots.default?.()])
  },
})
const PassThrough = defineComponent({ setup(_, { slots }) { return () => h('div', slots.default?.()) } })

describe.each([
  ['独立列设置', ColumnSettings], ['工具栏列设置', PageToolbar],
] as [string, Component][])('%s adapter', (_, Adapter) => {
  beforeEach(() => localStorage.clear())

  it('恢复后隐藏列仍可重显，重挂载和恢复默认不会丢列或列宽', async () => {
    localStorage.setItem(KEY, JSON.stringify([
      { key: 'b', label: '乙', visible: true }, { key: 'a', label: '甲', visible: false },
      { key: 'action', label: '操作', visible: true },
    ]))
    const allColumns = ref([
      { key: 'a', title: '甲', width: 224 }, { key: 'b', title: '乙', width: 130 },
      { key: 'c', title: '丙', hidden: true, width: 90 }, { key: 'action', title: '操作' },
    ])
    const columns = ref([...allColumns.value])
    const revision = ref(0)
    let emissionCount = 0
    const Harness = defineComponent({ setup() { return () => h(Adapter, {
      key: revision.value,
      columns: columns.value, allColumns: allColumns.value, storageKey: KEY,
      // 真实页面在模板中内联数组；每次父级重绘都会产生新引用。
      lockedKeys: ['action'],
      columnSettingsKey: KEY, menuItems: ['columns'], showSearch: false,
      'onUpdate:columns': (value: typeof columns.value) => { columns.value = value; emissionCount++ },
    }) } })
    const wrapper = mount(Harness, { global: {
      directives: { access: {} },
      stubs: { ADropdown: Dropdown, ACheckbox: Checkbox, AButton: { template: '<button><slot /></button>' },
        ATooltip: PassThrough, AMenu: PassThrough, AMenuItem: PassThrough, AModal: true, AUpload: true, AInputSearch: true },
    } })
    try {
      await nextTick()
      const selectedKeys = () => columns.value.map(column => column.key)
      expect(selectedKeys()).toEqual(['b', 'action'])
      const checkbox = (label: string) => wrapper.findAll('label').find(item => item.text() === label)!.get('input')
      await checkbox('甲').setValue(true)
      expect(selectedKeys()).toEqual(['b', 'a', 'action'])
      expect(columns.value.find(column => column.key === 'a')).toBe(allColumns.value[0])
      expect(columns.value.find(column => column.key === 'a')?.width).toBe(224)
      await checkbox('丙').setValue(true)
      expect(selectedKeys()).toEqual(['b', 'a', 'c', 'action'])
      allColumns.value[0]!.width = 290
      await checkbox('甲').setValue(false)
      revision.value++
      await nextTick()
      expect(selectedKeys()).toEqual(['b', 'c', 'action'])
      await checkbox('甲').setValue(true)
      expect(columns.value.find(column => column.key === 'a')?.width).toBe(290)
      await wrapper.findAll('button').find(button => button.text() === '恢复默认')!.trigger('click')
      expect(selectedKeys()).toEqual(['a', 'b', 'action'])
      expect((checkbox('丙').element as HTMLInputElement).checked).toBe(false)
      expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(4)
      expect(emissionCount).toBeLessThan(12)
    } finally { wrapper.unmount() }
  })
})
