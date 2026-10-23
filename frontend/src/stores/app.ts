import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getAccessCodes, getProfile, login, logout, updateMyProfile, type LoginParams, type MenuItem, type UserInfo } from '@/api/auth'
import { getPublicSettings } from '@/api/setting'
import { useAccessStore } from './access'
import { resetDictCache } from '@/utils/dict-cache'
import { setRecentVisitsAccount } from '@/composables/useRecentVisits'
import { clearListQueryState } from '@/composables/useListQuery'

interface SessionUser {
  id: number
  username: string
  role: string
  roles?: string[]
  displayName: string | null
  avatar: string | null
  deptId: number | null
  deptName: string | null
}

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const userInfo = ref<SessionUser | null>(null)
  const menus = ref<MenuItem[]>([])
  const access = useAccessStore()
  // 公开系统参数（登录后加载；失败保留默认值，重新登录重试）
  const publicSettings = ref<Record<string, string>>({})
  const siteName = computed(() => publicSettings.value['site.name'] || import.meta.env.VITE_APP_NAME || '企业管理系统')
  const helpContact = computed(() => publicSettings.value['help.contact'] || '')
  let publicSettingsJob: Promise<void> | null = null
  let publicSettingsJobGeneration = -1
  let generation = 0
  let ready = false
  let initialization: Promise<boolean> | null = null
  let signingIn: Promise<void> | null = null

  function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value }

  function refreshPublicSettings() {
    if (!userInfo.value) return
    // 去重只针对同一会话；清理后（generation 变化）旧请求在途也必须重新拉取
    if (publicSettingsJob && publicSettingsJobGeneration === generation) return
    const version = generation
    publicSettingsJobGeneration = version
    publicSettingsJob = getPublicSettings()
      .then((map) => { if (version === generation) publicSettings.value = map ?? {} })
      .catch(() => { /* 加载失败不阻塞会话，保留默认值 */ })
      .finally(() => { if (publicSettingsJobGeneration === version) publicSettingsJob = null })
  }

  function clearAuth() {
    clearListQueryState()
    resetDictCache()
    setRecentVisitsAccount()
    generation++
    ready = false
    initialization = null
    userInfo.value = null
    menus.value = []
    publicSettings.value = {}
    access.clearCodes()
  }

  function applyProfile(profile: UserInfo) {
    setRecentVisitsAccount(profile.id)
    const previous = userInfo.value?.id === profile.id ? userInfo.value : null
    userInfo.value = {
      id: profile.id,
      username: profile.username,
      role: profile.role?.code || 'user',
      roles: profile.roles ?? previous?.roles,
      displayName: profile.displayName ?? null,
      avatar: profile.avatar ?? null,
      deptId: profile.deptId ?? null,
      deptName: profile.deptName === undefined ? previous?.deptName ?? null : profile.deptName,
    }
  }

  function initialize(expectedId?: number): Promise<boolean> {
    if (ready && userInfo.value) return Promise.resolve(true)
    if (initialization) return initialization
    const version = generation
    const pending = (async () => {
      try {
        const profile = await getProfile()
        if (version !== generation) return false
        const codes = await getAccessCodes()
        if (version !== generation) return false
        if (expectedId !== undefined && profile.id !== expectedId) throw new Error('登录账号不一致')
        // 完整加载成功后再一次发布，调用方不会观察到用户/菜单/权限码的半成品。
        applyProfile(profile)
        menus.value = profile.menus || []
        access.setAccessCodes(codes)
        ready = true
        refreshPublicSettings()
        return true
      } catch {
        if (version === generation) clearAuth()
        return false
      } finally {
        if (version === generation) initialization = null
      }
    })()
    initialization = pending
    return pending
  }

  function ensureSession(): Promise<boolean> {
    if (signingIn) return signingIn.then(() => ready, () => false)
    return initialize()
  }

  function signIn(params: LoginParams): Promise<void> {
    if (signingIn) return Promise.reject(new Error('登录处理中，请稍后重试'))
    clearAuth()
    const version = generation
    const attempt = (async () => {
      const result = await login(params)
      if (version !== generation) throw new Error('登录状态已变化，请重试')
      if (!(await initialize(result.user.id))) throw new Error('登录信息加载失败，请重试')
    })()
    const tracked = attempt.finally(() => { if (signingIn === tracked) signingIn = null })
    signingIn = tracked
    return tracked
  }

  async function signOut() {
    await logout()
    clearAuth()
    location.href = '/login'
  }

  async function syncProfile(request: () => Promise<UserInfo>) {
    const version = generation
    const accountId = userInfo.value?.id
    const profile = await request()
    if (version !== generation || accountId == null || accountId !== profile.id) {
      throw new Error('登录状态已变化，请重试')
    }
    applyProfile(profile)
    return profile
  }

  function refreshProfile() { return syncProfile(getProfile) }
  function updateProfile(data: Parameters<typeof updateMyProfile>[0]) {
    return syncProfile(() => updateMyProfile(data))
  }

  return { sidebarCollapsed, userInfo, menus, siteName, helpContact, toggleSidebar, clearAuth, ensureSession, signIn, signOut, refreshProfile, updateProfile, refreshPublicSettings }
})
