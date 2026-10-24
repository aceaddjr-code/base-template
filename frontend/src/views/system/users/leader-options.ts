import { ref } from 'vue'
import { getUsersSimple, type UserSimple } from '@/api/user'

/** 直属上级候选标签「姓名（部门）」口径：新增弹窗与详情抽屉共用 */
export function formatLeaderOptionLabel(o: Pick<UserSimple, 'displayName' | 'username' | 'deptName'>): string {
  return `${o.displayName || o.username}${o.deptName ? `（${o.deptName}）` : ''}`
}

/** 直属上级候选（可跨部门）：加载失败静默，重开弹窗/抽屉时重试 */
export function useLeaderOptions() {
  const leaderOptions = ref<UserSimple[]>([])
  function loadLeaderOptions() {
    getUsersSimple().then((rows) => { leaderOptions.value = rows }).catch(() => {})
  }
  return { leaderOptions, loadLeaderOptions }
}
