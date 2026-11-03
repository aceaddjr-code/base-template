import { ref } from 'vue'
import { getUsersSimple, type UserSimple } from '@/api/user'

/** 用户候选标签「姓名（部门）」口径：用户表单与业务单据详情共用 */
export function formatUserOptionLabel(o: Pick<UserSimple, 'displayName' | 'username' | 'deptName'>): string {
  return `${o.displayName || o.username}${o.deptName ? `（${o.deptName}）` : ''}`
}

/** 全量用户简表候选（/users/simple，登录即可访问）：加载失败静默，重开弹窗/抽屉时重试 */
export function useUserOptions() {
  const userOptions = ref<UserSimple[]>([])
  function loadUserOptions() {
    getUsersSimple().then((rows) => { userOptions.value = rows }).catch(() => {})
  }
  /** 按 ID 解析姓名标签；找不到（已删除/加载失败）返回空串，由调用方决定回退展示 */
  function labelOf(userId: number | null | undefined): string {
    if (userId == null) return ''
    const row = userOptions.value.find((o) => o.id === userId)
    return row ? formatUserOptionLabel(row) : ''
  }
  return { userOptions, loadUserOptions, labelOf }
}
