import request from './request'

export interface LoginParams {
  loginid: string
  password: string
}

export function getAccessCodes(): Promise<string[]> {
  return request.get('/auth/codes')
}

export interface UserInfo {
  id: number
  username: string
  displayName: string
  email: string | null
  phone: string | null
  avatar?: string | null
  deptId: number | null
  deptName?: string | null
  role: { id: number; name: string; code: string } | null
  roles?: string[]
  menus: MenuItem[]
}

export interface MenuItem {
  id: number
  name: string
  path: string
  icon: string
  type?: 'menu' | 'button'
  children?: MenuItem[]
}

export interface LoginResult {
  user: UserInfo
}

/** 账号登录（JWT 自动写入 httpOnly Cookie） */
export function login(params: LoginParams): Promise<LoginResult> {
  return request.post('/auth/login', params)
}

/** 登出（清除 httpOnly Cookie） */
export function logout(): Promise<{ message: string }> {
  return request.post('/auth/logout')
}

/** 获取当前用户信息（含菜单），用于检查登录状态 */
export function getProfile(): Promise<UserInfo> {
  return request.get('/auth/profile')
}

export function updateMyProfile(data: { phone?: string | null; email?: string | null; avatar?: string | null }): Promise<UserInfo> {
  return request.patch('/auth/profile', data)
}

export interface ChangePasswordParams {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

export function changeMyPassword(data: ChangePasswordParams): Promise<{ message: string }> {
  return request.patch('/auth/password', data)
}

export function uploadAvatar(file: File): Promise<{ url: string }> {
  const fd = new FormData()
  fd.append('file', file)
  return request.post('/common/upload/image', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
