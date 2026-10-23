import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, CanceledError } from 'axios'
import { message } from 'ant-design-vue'
import { reportRequestError } from '@/utils/error-report'
import request from './request'

vi.mock('ant-design-vue', () => ({ message:{ error:vi.fn() } }))
vi.mock('@/utils/error-report', () => ({ reportRequestError:vi.fn() }))

afterEach(() => { vi.restoreAllMocks() })

describe('网络重试边界', () => {
  it('表单接管反馈保留字段错误和请求号，不叠加全局提示', async () => {
    vi.mocked(message.error).mockClear()
    const body = { code: 400, message: '请填写标题', requestId: 'form-123', fieldErrors: [{ path: 'title', code: 'isNotEmpty', message: '请填写标题' }] }
    const adapter = vi.fn(config => Promise.reject(new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, { data: body, status: 400, statusText: 'Bad Request', headers: {}, config })))
    const failure = await request.post('/form', {}, { adapter, errorFeedback: 'form' }).catch(error => error)
    expect(message.error).not.toHaveBeenCalled()
    expect(failure.requestId).toBe('form-123')
    expect(failure.response.data.fieldErrors).toEqual(body.fieldErrors)
    expect(adapter).toHaveBeenCalledOnce()
  })
  it('故障提示和上报带同一个请求号，保持原错误可供页面处理', async () => {
    vi.mocked(message.error).mockClear()
    vi.mocked(reportRequestError).mockClear()
    const adapter = vi.fn(config => Promise.reject(new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
      data: { code: 500, message: '服务器内部错误', requestId: 'backend-123' }, status: 500, statusText: 'Error', headers: { 'x-request-id': 'backend-123' }, config,
    })))
    const failure = await request.get('/failure', { adapter }).catch(error => error)
    expect(failure.requestId).toBe('backend-123')
    expect(message.error).toHaveBeenCalledExactlyOnceWith('服务器内部错误（请求号：backend-123）')
    expect(reportRequestError).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('主动取消不弹错误、不重试、不进入故障上报', async () => {
    vi.mocked(message.error).mockClear()
    vi.mocked(reportRequestError).mockClear()
    const adapter = vi.fn(config => Promise.reject(new CanceledError('cancelled', config)))
    await expect(request.get('/cancel', { adapter })).rejects.toThrow('cancelled')
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(message.error).not.toHaveBeenCalled()
    expect(reportRequestError).not.toHaveBeenCalled()
  })
  it('读取请求网络失败后最多自动重试一次', async () => {
    const adapter=vi.fn().mockImplementationOnce(config => Promise.reject(new AxiosError('offline','ERR_NETWORK',config)))
      .mockImplementationOnce(config => Promise.resolve({data:{code:200,data:{ok:true}},status:200,statusText:'OK',headers:{},config}))
    await expect(request.get('/read',{adapter})).resolves.toEqual({ok:true})
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it.each(['post','put','delete'] as const)('%s 请求超时不会被自动重放', async method => {
    const adapter=vi.fn(config => Promise.reject(new AxiosError('timeout','ECONNABORTED',config)))
    await expect(request.request({url:'/write',method,adapter})).rejects.toThrow('timeout')
    expect(adapter).toHaveBeenCalledTimes(1)
  })
})
