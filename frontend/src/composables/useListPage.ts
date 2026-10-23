import { reactive, ref } from 'vue'

export function useListPage(onChanged?: () => void) {
  const pagination = reactive({ current: 1, pageSize: 10, total: 0 })

  function handlePageChange(page: number, pageSize: number) {
    pagination.current = page
    pagination.pageSize = pageSize
    onChanged?.()
  }

  function handleSizeChange(_current: number, size: number) {
    pagination.current = 1
    pagination.pageSize = size
    onChanged?.()
  }

  const tableRef = ref<any>(null)
  /** 表格函数 ref：把 a-table 实例写入 tableRef（模板绑定用 `:ref="setTableRef"`） */
  function setTableRef(el: any) {
    tableRef.value = el
  }
  function stickySource() {
    const root = tableRef.value?.$el as HTMLElement | undefined
    if (!root) return null
    // 横向滚动容器随表格结构变化（antd vc-table 两种结构二选一）：
    //  - 普通结构（只设 :scroll="{ x }"）：.ant-table-content
    //  - 吸顶表头结构（:sticky="true" 或设了 scroll.y）：.ant-table-body——此时页面里没有 .ant-table-content
    // 只认 .ant-table-content 会让 sticky 页面的页脚横滚条静默不显示（可见内容被裁掉且无法拖动）。
    return (root.querySelector('.ant-table-body') ?? root.querySelector('.ant-table-content')) as HTMLElement | null
  }

  return { pagination, handlePageChange, handleSizeChange, tableRef, setTableRef, stickySource }
}
