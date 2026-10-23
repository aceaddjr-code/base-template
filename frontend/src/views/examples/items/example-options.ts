export const statusOptions = [
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'doing' },
  { label: '已完成', value: 'done' },
]
export function statusLabel(status: string) { return statusOptions.find(option => option.value === status)?.label || status }
export function statusColor(status: string) { return status === 'done' ? 'success' : status === 'doing' ? 'processing' : 'default' }
