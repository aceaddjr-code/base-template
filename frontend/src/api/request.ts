import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { message } from 'ant-design-vue'
import { reportRequestError } from '@/utils/error-report'
declare module 'axios' { interface AxiosRequestConfig { errorFeedback?: 'form' } }
export interface FormRequestOptions { errorFeedback?: 'form' }

export const API_BASE = '/api/v1'

function errorRequestId(response: AxiosResponse): string | undefined {
  const value = response.data?.requestId ?? response.headers?.['x-request-id']
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value) ? value : undefined
}
const failureText = (text: string, requestId?: string) => requestId ? `${text}（请求号：${requestId}）` : text

// 创建 axios 实例（withCredentials 让浏览器自动携带 httpOnly Cookie）
const request = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
  withCredentials: true,
})

// 请求拦截器（httpOnly Cookie 由浏览器自动携带，无需手动设置 Header）
request.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error),
)

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { data } = response

    if (!data || typeof data !== 'object') {
      return data
    }

    if (data.code !== 200) {
      const errorMessage = data.message || '请求失败'
      const requestId = errorRequestId(response)
      if (response.config.errorFeedback !== 'form') message.error(failureText(errorMessage, requestId))
      const error = Object.assign(new Error(errorMessage), { requestId, response, config: response.config })
      reportRequestError(error)
      return Promise.reject(error)
    }

    // 后端统一响应格式 { code, message, data }，解包取 data
    return data.data
  },
  (error) => {
    if (axios.isCancel(error) || error?.code === 'ERR_CANCELED') return Promise.reject(error)
    if (error.response) {
      const requestId = errorRequestId(error.response)
      error.requestId = requestId
      // 1. 不再 message.error('Unauthorized')——未登录/过期跳登录是预期流程，弹错纯噪音且并发 401 弹一串；
      // 2. 用 location 整页跳转而非 router.push——SPA 导航会与「守卫 next」及「登录成功跳转」竞态
      //    （守卫挂起时 401 push 会 abort 守卫导航 → redirect 丢失；登录成功 push 被迟到 401 顶回 → 点多次才进）。
      //    location 跳转终止一切进行中的导航，URL 用真实 location（无守卫竞态），登录页 /login 豁免防循环。
      if (error.response.status === 401) {
        if (location.pathname !== '/login') {
          const redirect = location.pathname + location.search
          const target =
            '/login' + (redirect && redirect !== '/' ? '?redirect=' + encodeURIComponent(redirect) : '')
          location.href = target
        }
        return Promise.reject(error)
      }

      const serverMessage = error.response.data?.message
      // 待改密受限会话访问业务接口：跳改密页（location 防守卫竞态，与 401 同口径），不再弹错
      if (error.response.status === 403 && error.response.data?.reason === 'PASSWORD_CHANGE_REQUIRED') {
        if (location.pathname !== '/change-password') location.href = '/change-password'
        return Promise.reject(error)
      }
      if (error.config?.errorFeedback !== 'form') message.error(failureText(serverMessage || error.message || '网络错误', requestId))
    } else {
      const cfg = error.config as (typeof error.config & { __retried?: boolean }) | undefined
      if (cfg && !cfg.__retried && ['get', 'head'].includes(String(cfg.method).toLowerCase())) {
        cfg.__retried = true
        return request(cfg)
      }
      if (error.config?.errorFeedback !== 'form') message.error('网络异常或请求超时，请稍后重试（服务器重启/网络波动时常见）')
    }

    reportRequestError(error)

    return Promise.reject(error)
  },
)

export default request
