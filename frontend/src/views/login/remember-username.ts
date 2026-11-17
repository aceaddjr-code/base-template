/** 只保存用户名；密码由浏览器密码管理器负责，应用不持久化密码。 */
const STORAGE_KEY = 'starter-login-username'
const LEGACY_KEY = 'starter-login-remember'
const MAX_USERNAME = 64

export function rememberUsername(username: string): void {
  try {
    if (username) localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, username: username.slice(0, MAX_USERNAME) }))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 浏览器拒绝存储时不影响登录。
  }
}

export function forgetUsername(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // 浏览器拒绝存储时不影响登录。
  }
}

export function readRememberedUsername(): string {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    // 先删除旧凭据，后解析；损坏的记录也不能留下密码。
    localStorage.removeItem(LEGACY_KEY)
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw && legacy) {
      const previous = JSON.parse(legacy)
      if (previous?.v === 1 && typeof previous.u === 'string') {
        rememberUsername(previous.u)
        raw = JSON.stringify({ v: 1, username: previous.u })
      }
    }
    if (!raw) return ''
    const record = JSON.parse(raw)
    return record?.v === 1 && typeof record.username === 'string' ? record.username.slice(0, MAX_USERNAME) : ''
  } catch {
    return ''
  }
}
