import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import Panel from './ExampleAttachmentPanel.vue'
import { getExampleFiles, addExampleFile, uploadExampleAttachment } from '@/api/example'
vi.mock('@/api/example', () => ({ getExampleFiles: vi.fn(), uploadExampleAttachment: vi.fn(), addExampleFile: vi.fn(), removeExampleFile: vi.fn(), exampleFileUrl: (id: number, file: number) => `/files/${id}/${file}` }))
vi.mock('@/api/attachment', () => ({ ATTACHMENT_MAX_SIZE: 500 * 1024 * 1024, formatSize: () => '1 KB' }))
const setup = () => mount(Panel, { props: { recordId: 1, editable: true }, global: { stubs: { AImage: true, AButton: { template: '<button><slot /></button>' }, APopconfirm: { template: '<div><slot /></div>' } } } })
beforeEach(() => vi.resetAllMocks())
it('附件与图片分区，列表失败可重试', async () => {
  vi.mocked(getExampleFiles).mockRejectedValueOnce(new Error('加载失败')).mockResolvedValue([{ id: 1, name: '文档.pdf', image: false, size: 1, mimeType: 'application/pdf', createdAt: '' }, { id: 2, name: '照片.png', image: true, size: 1, mimeType: 'image/png', createdAt: '' }])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('加载失败')
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.get('[aria-label="附件区域"]').text()).toContain('文档.pdf')
  expect(wrapper.get('[aria-label="附件区域"]').text()).not.toContain('照片.png')
  expect(wrapper.get('[aria-label="图片区域"]').find('a-image-stub').exists()).toBe(true)
})
it('挂接失败后重试使用同一个临时附件，避免重复上传', async () => {
  vi.mocked(getExampleFiles).mockResolvedValue([])
  vi.mocked(uploadExampleAttachment).mockResolvedValue({ id: 9 } as any)
  vi.mocked(addExampleFile).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValue({ id: 9 })
  const wrapper = setup(); await flushPromises()
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['data'], '文档.pdf')] })
  await input.trigger('change'); await flushPromises()
  expect(wrapper.text()).toContain('重试保存')
  await wrapper.findAll('button').find(button => button.text() === '重试保存')!.trigger('click'); await flushPromises()
  expect(uploadExampleAttachment).toHaveBeenCalledTimes(1)
  expect(addExampleFile).toHaveBeenNthCalledWith(2, 1, 9)
  expect(wrapper.text()).not.toContain('重试保存')
})

it('强制卸载时取消上传，不把迟到的临时文件挂接到已离开的单据', async () => {
  vi.mocked(getExampleFiles).mockResolvedValue([])
  let finish!: (value: any) => void
  vi.mocked(uploadExampleAttachment).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const wrapper = setup(); await flushPromises()
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['data'], '测试.pdf')] })
  await input.trigger('change'); await flushPromises()
  const signal = vi.mocked(uploadExampleAttachment).mock.calls[0]![1]!.signal!
  expect(signal.aborted).toBe(false)
  wrapper.unmount(); expect(signal.aborted).toBe(true)
  finish({ id: 11 }); await flushPromises()
  expect(addExampleFile).not.toHaveBeenCalled()
})

it('特殊图片提供下载入口，不请求浏览器不支持的预览；区域没有格式说明', async () => {
  vi.mocked(getExampleFiles).mockResolvedValue([{id:3,name:'照片.heic',image:true,previewable:false,size:1,mimeType:'image/heic',createdAt:''}])
  const wrapper = setup(); await flushPromises()
  expect(wrapper.find('a-image-stub').exists()).toBe(false)
  expect(wrapper.get('.image-download').attributes('download')).toBe('照片.heic')
  expect(wrapper.find('.file-hint').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('单个文件不超过')
  wrapper.unmount()
})
it.each([['工程图.dwg',0],['归档.tar.gz',0],['照片.heic',1],['矢量.svg',1]])('可以从对应区域上传扩展格式：%s', async (name, index) => {
  vi.mocked(getExampleFiles).mockResolvedValue([])
  vi.mocked(uploadExampleAttachment).mockResolvedValue({id:4} as any)
  vi.mocked(addExampleFile).mockResolvedValue({id:4})
  const wrapper = setup(); await flushPromises()
  const input=wrapper.findAll('input[type="file"]')[Number(index)]!
  Object.defineProperty(input.element,'files',{value:[new File(['data'],String(name))]})
  await input.trigger('change'); await flushPromises()
  expect(uploadExampleAttachment).toHaveBeenCalledOnce()
  expect(addExampleFile).toHaveBeenCalledWith(1,4)
  wrapper.unmount()
})
