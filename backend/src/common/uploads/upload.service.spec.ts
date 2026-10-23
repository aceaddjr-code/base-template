import { imageFileFilter, monthPath, uploadFilenameFactory } from './upload.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */

describe('UploadService（2026-08-11 层1 图片上传：过滤器/目录/文件名规则）', () => {
  const file = (mimetype: string, name: string) => ({ mimetype, originalname: name } as Express.Multer.File);

  describe('imageFileFilter（白名单：jpg/jpeg/png/webp/gif）', () => {
    it.each([
      ['image/jpeg', 'a.jpg'],
      ['image/jpeg', 'a.jpeg'],
      ['image/png', 'a.png'],
      ['image/webp', 'a.webp'],
      ['image/gif', 'a.gif'],
    ])('接受 %s / %s', (mimetype, name) => {
      const cb = jest.fn();
      imageFileFilter({}, file(mimetype, name), cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it.each([
      ['image/heic', 'a.heic'],
      ['image/jpeg', 'a.txt'],
      ['application/pdf', 'a.pdf'],
      ['image/jpeg', 'a.exe'],
    ])('拒绝 %s / %s（HEIC 等非白名单）', (mimetype, name) => {
      const cb = jest.fn();
      imageFileFilter({}, file(mimetype, name), cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
    });
  });

  describe('monthPath（月份子目录）', () => {
    it('生成 YYYY/MM 格式', () => {
      expect(monthPath(new Date(2026, 7, 15))).toBe('2026/08');
    });
    it('月份补零', () => {
      expect(monthPath(new Date(2026, 0, 1))).toBe('2026/01');
      expect(monthPath(new Date(2026, 11, 31))).toBe('2026/12');
    });
    it('默认当前时间', () => {
      const now = new Date();
      const expected = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      expect(monthPath()).toBe(expected);
    });
  });

  describe('uploadFilenameFactory（防覆盖/防路径注入）', () => {
    it('保留小写扩展名', () => {
      const cb = jest.fn();
      uploadFilenameFactory({}, file('image/jpeg', '照片.JPG'), cb);
      const name = cb.mock.calls[0][1] as string;
      expect(name).toMatch(/^\d+-[0-9a-f-]+\.jpg$/);
    });
    it('文件名含时间戳与 UUID（唯一防覆盖）', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      uploadFilenameFactory({}, file('image/png', 'a.png'), cb1);
      uploadFilenameFactory({}, file('image/png', 'b.png'), cb2);
      expect(cb1.mock.calls[0][1]).not.toBe(cb2.mock.calls[0][1]);
    });
  });
});
