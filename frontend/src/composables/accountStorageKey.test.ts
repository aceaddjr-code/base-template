import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { accountStorageKey } from './accountStorageKey'
import { useAppStore } from '@/stores/app'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('本机偏好的账号隔离 key', () => {
  it('登录账号使用 base:<id>，不同账号互不相同', () => {
    const store = useAppStore()
    store.userInfo = { id: 1, username: 'a', role: 'admin', displayName: '甲', avatar: null, deptId: null, deptName: null }
    expect(accountStorageKey('starter-cols-users-main')).toBe('starter-cols-users-main:1')
    store.userInfo = { ...store.userInfo, id: 2 }
    expect(accountStorageKey('starter-cols-users-main')).toBe('starter-cols-users-main:2')
  })

  it('未登录回退原 key，旧数据不被误归属', () => {
    expect(accountStorageKey('starter-cols-users-main')).toBe('starter-cols-users-main')
    localStorage.setItem('starter-cols-users-main', '[{"key":"title","visible":false}]')
    const store = useAppStore()
    store.userInfo = { id: 9, username: 'b', role: 'user', displayName: '乙', avatar: null, deptId: null, deptName: null }
    expect(accountStorageKey('starter-cols-users-main')).toBe('starter-cols-users-main:9')
    expect(localStorage.getItem('starter-cols-users-main:9')).toBeNull()
  })
})
