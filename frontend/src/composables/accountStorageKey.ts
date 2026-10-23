import { useAppStore } from '@/stores/app'

/**
 * 本机偏好按账号隔离的存储 key：`base:<userId>`。
 * 旧公共 key 没有可靠账号归属，保留原数据但不自动迁入任意账号（与 useRecentVisits 同一策略，见实施记录 F26）。
 * 未登录或 Pinia 未激活（单元测试）时回退原 key。
 */
export function accountStorageKey(base: string): string {
  try {
    const id = useAppStore().userInfo?.id
    return id ? `${base}:${id}` : base
  } catch {
    return base
  }
}
