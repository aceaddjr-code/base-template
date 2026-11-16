import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetPassword, readRemembered, rememberCredentials } from './remember-credential'

const KEY = 'starter-login-remember'

describe('登录页记住密码的本机凭据', () => {
  beforeEach(() => localStorage.clear())

  it('没有记录时按「没记住」处理', () => {
    expect(readRemembered()).toEqual({ username: '', password: '' })
  })

  it('保存后下次进登录页原样读回，含中文与空格', () => {
    rememberCredentials('admin', 'P@ss 中文 123')
    expect(readRemembered()).toEqual({ username: 'admin', password: 'P@ss 中文 123' })
  })

  it('落盘的不是明文密码', () => {
    rememberCredentials('admin', 'Sup3r-Secret')
    const raw = localStorage.getItem(KEY)
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('Sup3r-Secret')
    expect(JSON.parse(raw!).p).toBeTruthy()
  })

  it('取消记住只删密码，用户名留着下次填', () => {
    rememberCredentials('admin', 'Sup3r-Secret')
    forgetPassword('admin')
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
    expect(JSON.parse(localStorage.getItem(KEY)!).r).toBe(0)
  })

  it('不传用户名时保留原用户名', () => {
    rememberCredentials('zhangsan', 'abc123')
    forgetPassword()
    expect(readRemembered().username).toBe('zhangsan')
  })

  it('没有用户名可留时整条删掉', () => {
    rememberCredentials('admin', 'abc123')
    localStorage.removeItem(KEY)
    forgetPassword()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('换账号登录会整体覆盖上一台记住的凭据', () => {
    rememberCredentials('admin', 'abc123')
    rememberCredentials('lisi', 'def456')
    expect(readRemembered()).toEqual({ username: 'lisi', password: 'def456' })
  })

  it('空用户名不动本机记录，空密码只留用户名', () => {
    rememberCredentials('', 'abc123')
    expect(localStorage.getItem(KEY)).toBeNull()
    rememberCredentials('admin', 'abc123')
    rememberCredentials('admin', '')
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
  })

  it('整条记录损坏时按「没记住」处理', () => {
    const cases = ['{bad json', '[]', 'null', JSON.stringify({ v: 2, u: 'admin', r: 1, p: 'AAA=' }), JSON.stringify({ v: 1, r: 1 }), '"admin"']
    for (const raw of cases) {
      localStorage.setItem(KEY, raw)
      expect(readRemembered(), raw).toEqual({ username: '', password: '' })
    }
  })

  it('只有密码解不出来时用户名仍然留着，按未记住处理', () => {
    const cases = [JSON.stringify({ v: 1, u: 'admin', r: 1, p: 'not base64 !!' }), JSON.stringify({ v: 1, u: 'admin', r: 1 }), JSON.stringify({ v: 1, u: 'admin', r: 0, p: 123 })]
    for (const raw of cases) {
      localStorage.setItem(KEY, raw)
      expect(readRemembered(), raw).toEqual({ username: 'admin', password: '' })
    }
  })

  it('勾选状态下没密码可记时按未记住返回', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, u: 'admin', r: 1 }))
    expect(readRemembered()).toEqual({ username: 'admin', password: '' })
  })

  it('隐私模式写不进去也只是不记住，不抛错打断登录', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    expect(() => rememberCredentials('admin', 'abc123')).not.toThrow()
    expect(() => forgetPassword('admin')).not.toThrow()
    set.mockRestore()
  })

  it('读不了存储时按「没记住」处理，不影响登录页渲染', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readRemembered()).toEqual({ username: '', password: '' })
    get.mockRestore()
  })
})
