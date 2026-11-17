import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetUsername, readRememberedUsername, rememberUsername } from './remember-username'

describe('本机只记住用户名', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('首次读取为空，保存后只包含用户名', () => {
    expect(readRememberedUsername()).toBe('')
    rememberUsername('tester')
    expect(readRememberedUsername()).toBe('tester')
    expect(JSON.parse(localStorage.getItem('starter-login-username')!)).toEqual({ v: 1, username: 'tester' })
    forgetUsername()
    expect(readRememberedUsername()).toBe('')
  })

  it('旧版本记录只迁移用户名并删除整个凭据记录，不解析密码', () => {
    localStorage.setItem('starter-login-remember', JSON.stringify({ v: 1, u: 'tester', r: 1, p: 'secret-data' }))
    expect(readRememberedUsername()).toBe('tester')
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
    expect(localStorage.length).toBe(1)
    expect(JSON.parse(localStorage.getItem('starter-login-username')!)).toEqual({ v: 1, username: 'tester' })
  })

  it('已有新用户名时不被旧记录覆盖，仍清除旧密码', () => {
    rememberUsername('new-user')
    localStorage.setItem('starter-login-remember', JSON.stringify({ v: 1, u: 'old-user', p: 'secret-data' }))
    expect(readRememberedUsername()).toBe('new-user')
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
  })

  it('损坏的旧凭据也必须删除', () => {
    localStorage.setItem('starter-login-remember', '{bad-json')
    expect(readRememberedUsername()).toBe('')
    expect(localStorage.getItem('starter-login-remember')).toBeNull()
  })

  it.each(['{bad-json', 'null', '[]', '{"v":2,"username":"test"}', '{"v":1,"username":123}'])('新记录格式不合法时不回填：%s', raw => {
    localStorage.setItem('starter-login-username', raw)
    expect(readRememberedUsername()).toBe('')
  })

  it('存储不可用也不阻断登录', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readRememberedUsername()).toBe('')
    expect(() => rememberUsername('tester')).not.toThrow()
    expect(() => forgetUsername()).not.toThrow()
  })
})
