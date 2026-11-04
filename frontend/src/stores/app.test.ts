import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import type { UserInfo } from '@/api/auth'
import { useAppStore } from './app'
import { useAccessStore } from './access'

const auth = vi.hoisted(() => ({ getProfile: vi.fn(), getAccessCodes: vi.fn(), login: vi.fn(), logout: vi.fn(), updateMyProfile: vi.fn() }))
vi.mock('@/api/auth', () => auth)
const settingApi = vi.hoisted(() => ({ getPublicSettings: vi.fn() }))
vi.mock('@/api/setting', () => settingApi)

function profile(id = 1): UserInfo {
  return { id, username: 'user' + id, displayName: '用户' + id, email: null, phone: null,
    deptId: 8, deptName: '部门甲', avatar: '/uploads/avatar.png',
    role: { id: 2, name: '普通用户', code: 'user' }, roles: ['user', 'reviewer'],
    menus: [{ id, name: '事项', path: '/examples/items', icon: '' }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  auth.getProfile.mockResolvedValue(profile())
  auth.getAccessCodes.mockResolvedValue(['example-items:view'])
  auth.login.mockResolvedValue({ user: profile() })
  auth.logout.mockResolvedValue({ message: '已退出' })
  settingApi.getPublicSettings.mockResolvedValue({})
  location.href = 'http://localhost/home'
})

describe('登录会话完整行为', () => {
  it('保留侧栏切换，初始没有用户和授权', () => {
    const store = useAppStore()
    expect(store.sidebarCollapsed).toBe(false)
    store.toggleSidebar()
    expect(store.sidebarCollapsed).toBe(true)
    expect(store.userInfo).toBeNull()
    expect(store.menus).toEqual([])
  })

  it('并发初始化只加载一次并统一映射头像、部门和多角色', async () => {
    const store = useAppStore()
    expect(await Promise.all([store.ensureSession(), store.ensureSession()])).toEqual([true, true])
    expect(auth.getProfile).toHaveBeenCalledTimes(1)
    expect(auth.getAccessCodes).toHaveBeenCalledTimes(1)
    expect(store.userInfo).toMatchObject({ id: 1, avatar: '/uploads/avatar.png', deptName: '部门甲', roles: ['user', 'reviewer'] })
    expect(store.menus).toEqual(profile().menus)
    expect(useAccessStore().accessCodes).toEqual(['example-items:view'])
    await store.ensureSession()
    expect(auth.getProfile).toHaveBeenCalledTimes(1)
  })

  it('权限码未成功前不发布用户和菜单的半成品状态', async () => {
    const codes = deferred<string[]>()
    auth.getAccessCodes.mockReturnValue(codes.promise)
    const store = useAppStore()
    const pending = store.ensureSession()
    await flushPromises()
    expect(store.userInfo).toBeNull()
    expect(store.menus).toEqual([])
    codes.resolve(['example-items:view'])
    expect(await pending).toBe(true)
  })

  it('权限加载失败清空全部会话状态并允许重新初始化', async () => {
    auth.getAccessCodes.mockRejectedValueOnce(new Error('offline'))
    const store = useAppStore()
    expect(await store.ensureSession()).toBe(false)
    expect(store.userInfo).toBeNull()
    expect(store.menus).toEqual([])
    expect(useAccessStore().accessCodes).toEqual([])
    expect(await store.ensureSession()).toBe(true)
    expect(auth.getProfile).toHaveBeenCalledTimes(2)
  })

  it('清理后迟到的旧账号初始化不能覆盖新会话', async () => {
    const old = deferred<UserInfo>()
    auth.getProfile.mockReturnValueOnce(old.promise).mockResolvedValueOnce(profile(2))
    const store = useAppStore()
    const pending = store.ensureSession()
    store.clearAuth()
    expect(await store.ensureSession()).toBe(true)
    old.resolve(profile(1))
    expect(await pending).toBe(false)
    expect(store.userInfo?.id).toBe(2)
  })

  it('重新登录统一替换用户、菜单和权限', async () => {
    const store = useAppStore()
    await store.ensureSession()
    auth.login.mockResolvedValue({ user: profile(2) })
    auth.getProfile.mockResolvedValue(profile(2))
    auth.getAccessCodes.mockResolvedValue(['second:view'])
    await store.signIn({ loginid: 'user2', password: 'test-only' })
    expect(store.userInfo?.id).toBe(2)
    expect(store.menus).toEqual(profile(2).menus)
    expect(useAccessStore().accessCodes).toEqual(['second:view'])
  })

  it('登录失败不保留上一账号的菜单与授权', async () => {
    const store = useAppStore()
    await store.ensureSession()
    auth.login.mockRejectedValue(new Error('密码错误'))
    await expect(store.signIn({ loginid: 'bad', password: 'test-only' })).rejects.toThrow('密码错误')
    expect(store.userInfo).toBeNull()
    expect(store.menus).toEqual([])
    expect(useAccessStore().accessCodes).toEqual([])
  })

  it('刷新资料保留响应中省略的多角色和部门名称', async () => {
    const store = useAppStore()
    await store.ensureSession()
    auth.getProfile.mockResolvedValue({ ...profile(), roles: undefined, deptName: undefined, avatar: '/uploads/new.png' })
    await store.refreshProfile()
    expect(store.userInfo).toMatchObject({ roles: ['user', 'reviewer'], deptName: '部门甲', avatar: '/uploads/new.png' })
    expect(useAccessStore().accessCodes).toEqual(['example-items:view'])
  })

  it('保存资料统一同步显示状态，失败保留原资料', async () => {
    const store = useAppStore()
    await store.ensureSession()
    auth.updateMyProfile.mockResolvedValue({ ...profile(), displayName: '新姓名', avatar: '/uploads/new.png' })
    await store.updateProfile({ avatar: '/uploads/new.png' })
    expect(store.userInfo).toMatchObject({ displayName: '新姓名', avatar: '/uploads/new.png' })
    auth.updateMyProfile.mockRejectedValue(new Error('保存失败'))
    await expect(store.updateProfile({ phone: '123' })).rejects.toThrow('保存失败')
    expect(store.userInfo?.displayName).toBe('新姓名')
  })

  it('旧会话迟到的资料响应不能写回新账号', async () => {
    const store = useAppStore()
    await store.ensureSession()
    const old = deferred<UserInfo>()
    auth.getProfile.mockReturnValueOnce(old.promise).mockResolvedValueOnce(profile(2))
    const updating = store.refreshProfile()
    store.clearAuth()
    await store.ensureSession()
    old.resolve(profile(1))
    await expect(updating).rejects.toThrow('登录状态已变化')
    expect(store.userInfo?.id).toBe(2)
  })

  it('退出清理完整状态及缓存并整页跳转登录', async () => {
    const store = useAppStore()
    await store.ensureSession()
    await store.signOut()
    expect(auth.logout).toHaveBeenCalledTimes(1)
    expect(store.userInfo).toBeNull()
    expect(store.menus).toEqual([])
    expect(useAccessStore().accessCodes).toEqual([])
    expect(location.pathname).toBe('/login')
    await store.ensureSession()
    expect(auth.getProfile).toHaveBeenCalledTimes(2)
  })

  it('登录处理中路由等待同一会话，不提前读取旧Cookie的资料', async () => {
    const credentials = deferred<{ user: UserInfo }>()
    auth.login.mockReturnValue(credentials.promise)
    const store = useAppStore()
    const login = store.signIn({ loginid: 'user1', password: 'test-only' })
    const route = store.ensureSession()
    expect(auth.getProfile).not.toHaveBeenCalled()
    credentials.resolve({ user: profile() })
    await login
    expect(await route).toBe(true)
    expect(auth.getProfile).toHaveBeenCalledTimes(1)
  })

  it('同一会话不重放并发登录请求', async () => {
    const credentials = deferred<{ user: UserInfo }>()
    auth.login.mockReturnValue(credentials.promise)
    const store = useAppStore()
    const first = store.signIn({ loginid: 'user1', password: 'test-only' })
    await expect(store.signIn({ loginid: 'user2', password: 'test-only' })).rejects.toThrow('登录处理中')
    credentials.resolve({ user: profile() })
    await first
    expect(auth.login).toHaveBeenCalledTimes(1)
  })

  it('旧权限请求失败不会清除已经加载的新账号', async () => {
    const oldCodes = deferred<string[]>()
    auth.getAccessCodes.mockReturnValueOnce(oldCodes.promise).mockResolvedValueOnce(['new:view'])
    const store = useAppStore()
    const old = store.ensureSession()
    await flushPromises()
    store.clearAuth()
    auth.getProfile.mockResolvedValue(profile(2))
    await store.ensureSession()
    oldCodes.reject(new Error('old request failed'))
    expect(await old).toBe(false)
    expect(store.userInfo?.id).toBe(2)
    expect(useAccessStore().accessCodes).toEqual(['new:view'])
  })

  it('退出请求失败时保留原会话且不跳转', async () => {
    const store = useAppStore()
    await store.ensureSession()
    auth.logout.mockRejectedValue(new Error('offline'))
    await expect(store.signOut()).rejects.toThrow('offline')
    expect(store.userInfo?.id).toBe(1)
    expect(location.pathname).toBe('/home')
  })
})

describe('待改密受限会话', () => {
  const restrictedProfile: UserInfo = {
    id: 9, username: 'tempuser', displayName: '临时用户', mustChangePassword: true,
  }

  it('受限会话不请求业务初始化接口，不带菜单与权限码，标志置位', async () => {
    auth.getProfile.mockResolvedValue(restrictedProfile)
    const store = useAppStore()
    expect(await store.ensureSession()).toBe(true)
    expect(auth.getAccessCodes).not.toHaveBeenCalled()
    expect(settingApi.getPublicSettings).not.toHaveBeenCalled()
    expect(store.mustChangePassword).toBe(true)
    expect(store.userInfo).toMatchObject({ id: 9, username: 'tempuser' })
    expect(store.menus).toEqual([])
    expect(useAccessStore().accessCodes).toEqual([])
  })

  it('受限登录同样成立：登录后 initialize 直接进入受限态', async () => {
    auth.login.mockResolvedValue({ user: { ...restrictedProfile } })
    auth.getProfile.mockResolvedValue(restrictedProfile)
    const store = useAppStore()
    await store.signIn({ loginid: 'tempuser', password: 'test-only' })
    expect(store.mustChangePassword).toBe(true)
    expect(auth.getAccessCodes).not.toHaveBeenCalled()
  })

  it('改密完成（clearAuth）后标志复位，可重新完整初始化', async () => {
    auth.getProfile.mockResolvedValueOnce(restrictedProfile).mockResolvedValueOnce(profile())
    const store = useAppStore()
    await store.ensureSession()
    expect(store.mustChangePassword).toBe(true)
    store.clearAuth()
    expect(store.mustChangePassword).toBe(false)
    expect(await store.ensureSession()).toBe(true)
    expect(store.mustChangePassword).toBe(false)
    expect(auth.getAccessCodes).toHaveBeenCalledTimes(1)
    expect(store.menus).toEqual(profile().menus)
  })
})

describe('公开系统参数', () => {
  it('初始化后加载公共参数，品牌名与帮助联系方式跟随', async () => {
    settingApi.getPublicSettings.mockResolvedValue({ 'site.name': '供应链平台', 'help.contact': 'support@example.com' })
    const store = useAppStore()
    expect(store.siteName).toBe('BaseSuite平台')
    expect(await store.ensureSession()).toBe(true)
    await flushPromises()
    expect(settingApi.getPublicSettings).toHaveBeenCalledTimes(1)
    expect(store.siteName).toBe('供应链平台')
    expect(store.helpContact).toBe('support@example.com')
  })

  it('公共参数加载失败不阻塞会话，保留回退名称', async () => {
    settingApi.getPublicSettings.mockRejectedValue(new Error('offline'))
    const store = useAppStore()
    expect(await store.ensureSession()).toBe(true)
    await flushPromises()
    expect(store.userInfo?.id).toBe(1)
    expect(store.siteName).toBe('BaseSuite平台')
    expect(store.helpContact).toBe('')
  })

  it('退出登录清空公共参数，切换账号后重新拉取', async () => {
    settingApi.getPublicSettings.mockResolvedValue({ 'site.name': '供应链平台' })
    const store = useAppStore()
    await store.ensureSession()
    await flushPromises()
    expect(store.siteName).toBe('供应链平台')
    await store.signOut()
    expect(store.siteName).toBe('BaseSuite平台')
    settingApi.getPublicSettings.mockResolvedValue({ 'site.name': '另一平台' })
    await store.ensureSession()
    await flushPromises()
    expect(store.siteName).toBe('另一平台')
    expect(settingApi.getPublicSettings).toHaveBeenCalledTimes(2)
  })

  it('清理后迟到的公共参数响应不能写回新会话', async () => {
    const stale = deferred<Record<string, string>>()
    settingApi.getPublicSettings.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ 'site.name': '新平台' })
    const store = useAppStore()
    await store.ensureSession()
    store.clearAuth()
    await store.ensureSession()
    stale.resolve({ 'site.name': '旧平台' })
    await flushPromises()
    expect(store.siteName).toBe('新平台')
  })
})
