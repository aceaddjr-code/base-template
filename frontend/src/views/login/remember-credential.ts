/**
 * 登录页「记住密码」的本机凭据读写（只有登录页一个调用方，不抽 composable）。
 *
 * 保存范围：仅当前浏览器的 localStorage，不上报服务端、不参与任何鉴权裁决。
 * 密码写入前做 XOR + base64 混淆，目的是不让明文直接出现在开发者工具里；
 * 混淆掩码随前端代码发布，**这不是加密**，真正的保护边界是「本人电脑 + 系统锁屏」，
 * 因此页面对应给出「公共电脑请勿勾选」提示，用户取消勾选即刻删除密码。
 */
const STORAGE_KEY = 'starter-login-remember'
const VERSION = 1
const MASK = 'base-template-login-remember'
const MAX_USERNAME = 64
const MAX_PASSWORD = 256

interface RememberRecord {
  v: number
  /** 用户名：与是否记住密码无关，未勾选也保留，下次进登录页仍填好 */
  u: string
  /** 1 = 记住密码（p 为混淆后的密码）；0 = 只记用户名 */
  r: 0 | 1
  p?: string
}

export interface RememberedCredential {
  username: string
  /** 未记住密码时为空串 */
  password: string
}

function mask(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const maskBytes = new TextEncoder().encode(MASK)
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ maskBytes[i % maskBytes.length]
  let binary = ''
  for (const byte of out) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** 解不出合法 UTF-8 即视为非本功能写入的数据，返回 null 由调用方忽略 */
function unmask(encoded: string): string | null {
  try {
    const binary = atob(encoded)
    const maskBytes = new TextEncoder().encode(MASK)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) ^ maskBytes[i % maskBytes.length]
    return new TextDecoder('utf-8', { fatal: true }).decode(out)
  } catch {
    return null
  }
}

function readRecord(): RememberRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Partial<RememberRecord>
    if (record.v !== VERSION || typeof record.u !== 'string' || (record.r !== 0 && record.r !== 1)) return null
    return record as RememberRecord
  } catch {
    return null
  }
}

function writeRecord(record: RememberRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* 隐私模式等写不进去时静默降级：本次不记住，不影响登录 */
  }
}

/** 读回上次记住的登录信息；记录缺失或损坏按「没记住」处理，密码解不出来时用户名仍然留着。 */
export function readRemembered(): RememberedCredential {
  const record = readRecord()
  if (!record) return { username: '', password: '' }
  const password = record.r === 1 && typeof record.p === 'string' ? unmask(record.p) : null
  return { username: record.u.slice(0, MAX_USERNAME), password: password ?? '' }
}

/** 登录成功后落盘：只有这一刻才写密码，密码输错不会被记成「上次的密码」。 */
export function rememberCredentials(username: string, password: string): void {
  if (!username) return // 连用户名都没有就没有可记的账号，保持本机原记录不动
  if (!password) return forgetPassword(username)
  writeRecord({ v: VERSION, u: username.slice(0, MAX_USERNAME), r: 1, p: mask(password.slice(0, MAX_PASSWORD)) })
}

/**
 * 删除已记住的密码，用户名保留（取消勾选、临时密码即将作废、改密完成都要走这里）。
 * 传入 username 时把用户名更新为它，没得可留就整条删掉。
 */
export function forgetPassword(username?: string): void {
  const previous = readRecord()
  const kept = (username || previous?.u || '').slice(0, MAX_USERNAME)
  if (!kept) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* 同 writeRecord：删不掉也不影响登录 */
    }
    return
  }
  writeRecord({ v: VERSION, u: kept, r: 0 })
}
