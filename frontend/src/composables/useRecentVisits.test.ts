import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecentVisits, recentVisits, recordVisit, setRecentVisitsAccount } from './useRecentVisits'

beforeEach(() => { localStorage.clear(); setRecentVisitsAccount() })
describe('最近访问的账号隔离', () => {
  it('切换及退出账号立即移除上一账号可见记录，返回原账号可恢复', () => {
    setRecentVisitsAccount(1)
    recordVisit('/system/users', '用户管理')
    setRecentVisitsAccount(2)
    expect(recentVisits.value).toEqual([])
    recordVisit('/examples/items', '示例事项')
    setRecentVisitsAccount()
    expect(recentVisits.value).toEqual([])
    recordVisit('/system/users', '未登录不记录')
    setRecentVisitsAccount(1)
    expect(recentVisits.value.map(item => item.path)).toEqual(['/system/users'])
    clearRecentVisits()
    setRecentVisitsAccount(2)
    expect(recentVisits.value.map(item => item.path)).toEqual(['/examples/items'])
  })
  it('旧公共 key 不被误归属，重复访问置顶且不存敏感查询参数', () => {
    const legacy = JSON.stringify([{ path: '/system/users', title: '旧记录', at: Date.now() }])
    localStorage.setItem('starter-recent-visits', legacy)
    setRecentVisitsAccount(3)
    expect(recentVisits.value).toEqual([])
    recordVisit('/home', '首页')
    recordVisit('/test?token=value', '参数链接')
    recordVisit('//external.example', '外站')
    expect(recentVisits.value).toEqual([])
    recordVisit('/one', '一')
    recordVisit('/two', '二')
    recordVisit('/one', '一更新')
    expect(recentVisits.value.map(item => item.path)).toEqual(['/one', '/two'])
    expect(localStorage.getItem('starter-recent-visits')).toBe(legacy)
  })
});
