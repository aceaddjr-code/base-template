import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AttachmentService } from './attachment.service';
import { Attachment } from './attachment.entity';
import { SystemLogService } from '../system/system-log.service';

describe('AttachmentService 生命周期（F08）', () => {
  let service: AttachmentService;
  let repo: { save: jest.Mock; findOne: jest.Mock; find: jest.Mock; remove: jest.Mock; update: jest.Mock; softDelete: jest.Mock; createQueryBuilder: jest.Mock; manager?: any };
  let logWrite: jest.Mock;
  let tmpDir: string;
  let nextId: number;
  const rows = new Map<number, any>();
  const uploader = { sub: 7, username: 'u7', roleCode: 'user' } as any;
  const admin = { sub: 1, username: 'admin', roleCode: 'admin' } as any;

  function writeStoreFile(storagePath: string): void {
    const abs = join(tmpDir, storagePath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, 'data');
  }

  async function seedRow(overrides: Partial<any> = {}): Promise<any> {
    const id = nextId++;
    const row = {
      id, storagePath: `2026/10/${id}-f.pdf`, originalName: `附件${id}.pdf`,
      mimeType: 'application/pdf', size: 10, status: 'temp', origin: 'center',
      entityType: null, entityId: null, entityTitle: null,
      createdBy: 7, ownerId: 7, createdAt: new Date(), ...overrides,
    };
    rows.set(id, row);
    return row;
  }

  /** resolveForDownload 对已挂接业务附件需要反查单据行（ownerId）做数据范围裁决 */
  function mockDocLookup(ownerId: number | null | undefined) {
    const chain: any = {};
    chain.from = () => chain;
    chain.select = () => chain;
    chain.where = () => chain;
    chain.getRawOne = jest.fn(async () => (ownerId === undefined ? null : { ownerId }));
    repo.manager!.createQueryBuilder = jest.fn(() => chain);
  }

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'att-spec-'));
  });

  beforeEach(async () => {
    rows.clear();
    nextId = 1;
    repo = {
      save: jest.fn(async (data: any) => {
        const id = data.id ?? nextId++;
        const row = { createdAt: new Date(), createdBy: data.createdBy ?? null, ...data, id };
        rows.set(id, row);
        return row;
      }),
      findOne: jest.fn(async ({ where }: any) => rows.get(where?.id) ?? null),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn(async (row: any) => { rows.delete(row.id); return row; }),
      update: jest.fn(async (id: number, values: any) => Object.assign(rows.get(id), values)),
      softDelete: jest.fn(async (id: number) => { rows.get(id).deletedAt = new Date(); }),
      createQueryBuilder: jest.fn(() => { const q: any = { where: () => q, andWhere: () => q, getOne: async () => ({ id: 1 }) }; return q; }),
    };
    repo.manager = { transaction: async (fn: any) => fn({ getRepository: () => repo }) };
    logWrite = jest.fn().mockResolvedValue(undefined);
    const config = { get: (key: string, fallback?: any) => (key === 'ATTACHMENT_PRIVATE_DIR' ? tmpDir : fallback) } as unknown as ConfigService;
    const module = await Test.createTestingModule({
      providers: [
        AttachmentService,
        { provide: getRepositoryToken(Attachment), useValue: repo },
        { provide: ConfigService, useValue: config },
        { provide: SystemLogService, useValue: { write: logWrite } },
      ],
    }).compile();
    service = module.get(AttachmentService);
  });

  it('保存附件:非法扩展名拒绝,合法则落文件库行(origin/ownerId)并写审计', async () => {
    await expect(service.saveFile({ originalname: 'a.exe', mimetype: 'application/x-exe', size: 10, filename: '1-x.exe', path: join(tmpDir, '2026/10/1-x.exe') } as any, uploader))
      .rejects.toMatchObject({ status: 400 });
    const view = await service.saveFile({ originalname: '报价单.pdf', mimetype: 'application/pdf', size: 100, filename: '1-q.pdf', path: join(tmpDir,'2026/10/1-q.pdf') } as any, uploader);
    expect(view.status).toBe('temp');
    expect(view.origin).toBe('center');
    expect(view.mine).toBe(true);
    expect(rows.get(view.id).ownerId).toBe(7);
    expect(rows.get(view.id).origin).toBe('center');
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entityType: 'attachments' }));
  });

  it('业务表单上传落 business 来源，供挂接校验区分文件库文件', async () => {
    const view = await service.saveFile({ originalname: '单据.pdf', mimetype: 'application/pdf', size: 5, filename: 'biz.pdf', path: join(tmpDir, '2026/10/biz.pdf') } as any, uploader, 'business');
    expect(view.origin).toBe('business');
    expect(rows.get(view.id).origin).toBe('business');
  });

  it.each(['工程图.DWG', '模型.step', '设计.psd', '归档.tar.gz', '说明.rtf', '配置.json', '视频.mp4', '图片.BMP', '照片.heic', '扫描.tiff', '图标.svg'])('扩展格式允许保存：%s', async name => {
    await expect(service.saveFile({ originalname: name, filename: 'expanded-file', path: join(tmpDir, '2026/10/expanded-file'), size: 4, mimetype: 'application/octet-stream' } as any, uploader)).resolves.toMatchObject({ name });
  });

  it('文件库下载:上传者可下;他人无数据范围 403;他人配置附件范围 all 可下;管理员可下;文件丢失 503', async () => {
    const row = await seedRow();
    writeStoreFile(row.storagePath);
    const resolved = await service.resolveForDownload(row.id, uploader);
    expect(resolved.row.id).toBe(row.id);
    await expect(service.resolveForDownload(row.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 403 });
    const scopedUser = { sub: 8, username: 'x', roleCode: 'user', dataScopes: [{ scopeKey: 'attachments', scopeType: 'all', viewSelf: 1, viewOthers: 1 }] } as any;
    await expect(service.resolveForDownload(row.id, scopedUser)).resolves.toBeDefined();
    await expect(service.resolveForDownload(row.id, admin)).resolves.toBeDefined();
    rows.get(row.id).storagePath = '2026/10/missing.pdf';
    await expect(service.resolveForDownload(row.id, uploader)).rejects.toMatchObject({ status: 503 });
  });

  it('跨月保存沿用实际落盘目录，下载仍能找到文件', async () => {
    const storagePath = '2026/01/cross-month.pdf'; writeStoreFile(storagePath);
    const view = await service.saveFile({ originalname: '跨月.pdf', filename: 'cross-month.pdf', path: join(tmpDir, storagePath), size: 4, mimetype: 'application/pdf' } as any, uploader);
    expect(rows.get(view.id).storagePath).toBe(storagePath);
    await expect(service.resolveForDownload(view.id, uploader)).resolves.toMatchObject({ streamPath: join(tmpDir, storagePath) });
  });

  it('数据库保存失败和空文件校验失败时清理已落盘文件', async () => {
    const storagePath = '2026/10/save-failed.pdf'; writeStoreFile(storagePath);
    const file = { originalname: '测试.pdf', filename: 'save-failed.pdf', path: join(tmpDir, storagePath), size: 4 } as any;
    repo.save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.saveFile(file, uploader)).rejects.toThrow('database unavailable');
    expect(existsSync(file.path)).toBe(false);
    writeStoreFile(storagePath);
    await expect(service.saveFile({ ...file, size: 0 }, uploader)).rejects.toMatchObject({ status: 400 });
    expect(existsSync(file.path)).toBe(false);
    expect(rows.size).toBe(0);
  });

  it('500MB 边界可保存，超过一字节及空文件拒绝', async () => {
    const file = { originalname: '大文件.zip', mimetype: 'application/zip', filename: 'large.zip', path: join(tmpDir,'2026/10/large.zip'), size: 500 * 1024 * 1024 };
    await expect(service.saveFile(file as any, uploader)).resolves.toMatchObject({ size: file.size });
    await expect(service.saveFile({ ...file, size: file.size + 1 } as any, uploader)).rejects.toMatchObject({ status: 400 });
    await expect(service.saveFile({ ...file, size: 0 } as any, uploader)).rejects.toMatchObject({ status: 400 });
  });

  it('业务附件下载跟随单据数据范围:无范围 403;配置单据范围/单据归属人可下;单据不存在 404;管理员放行', async () => {
    const bound = await seedRow({ status: 'bound', origin: 'business', entityType: 'example-items', entityId: 9 });
    writeStoreFile(bound.storagePath);
    mockDocLookup(3);
    await expect(service.resolveForDownload(bound.id, uploader)).rejects.toMatchObject({ status: 403 });
    const docOwner = { sub: 3, username: 'owner', roleCode: 'user' } as any;
    await expect(service.resolveForDownload(bound.id, docOwner)).resolves.toBeDefined();
    const scopedUser = { sub: 8, username: 'x', roleCode: 'user', dataScopes: [{ scopeKey: 'example-items', scopeType: 'all', viewSelf: 1, viewOthers: 1 }] } as any;
    await expect(service.resolveForDownload(bound.id, scopedUser)).resolves.toBeDefined();
    await expect(service.resolveForDownload(bound.id, admin)).resolves.toBeDefined();
    mockDocLookup(undefined);
    await expect(service.resolveForDownload(bound.id, scopedUser)).rejects.toMatchObject({ status: 404 });
  });

  it('未注册类型的已挂接附件保守仅上传者可下载', async () => {
    const stranger = await seedRow({ status: 'bound', origin: 'business', entityType: 'other-type', entityId: 1, createdBy: 9, ownerId: 9 });
    writeStoreFile(stranger.storagePath);
    await expect(service.resolveForDownload(stranger.id, uploader)).rejects.toMatchObject({ status: 404 });
    await expect(service.resolveForDownload(stranger.id, { sub: 9, username: 'owner9', roleCode: 'user' } as any)).resolves.toBeDefined();
    await expect(service.resolveForDownload(stranger.id, admin)).resolves.toBeDefined();
  });

  it('删除:文件库上传者可删且文件留待回收站;他人无范围 403;业务 bound 一律从单据管理', async () => {
    const row = await seedRow();
    writeStoreFile(row.storagePath);
    const result = await service.remove(row.id, uploader);
    expect(result.message).toBe('删除成功');
    expect(existsSync(join(tmpDir, row.storagePath))).toBe(true);
    expect(rows.get(row.id)).toMatchObject({ recycleHeld: 1, deletedAt: expect.any(Date) });

    const others = await seedRow();
    writeStoreFile(others.storagePath);
    await expect(service.remove(others.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 403 });
    expect(existsSync(join(tmpDir, others.storagePath))).toBe(true);

    const bound = await seedRow({ status: 'bound', origin: 'business', entityType: 'example-items', entityId: 1, createdBy: 1, ownerId: 1 });
    writeStoreFile(bound.storagePath);
    await expect(service.remove(bound.id, uploader)).rejects.toMatchObject({ status: 404 });
    expect(existsSync(join(tmpDir, bound.storagePath))).toBe(true);
  });

  it('业务暂存附件仅上传者可删可下载，他人 404', async () => {
    const pending = await seedRow({ origin: 'business' });
    writeStoreFile(pending.storagePath);
    await expect(service.resolveForDownload(pending.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(pending.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 404 });
    expect(existsSync(join(tmpDir, pending.storagePath))).toBe(true);
    await expect(service.remove(pending.id, uploader)).resolves.toMatchObject({ message: '删除成功' });
  });

  it('回收只清软删行:事务内复核保留未删行(含未挂接/已挂接),清除软删行文件', async () => {
    const pending = await seedRow({ origin: 'business' }); writeStoreFile(pending.storagePath);
    const bound = await seedRow({ status: 'bound', origin: 'business', entityType: 'example-items', entityId: 1 }); writeStoreFile(bound.storagePath);
    const deleted = await seedRow({ status: 'bound', deletedAt: new Date() }); writeStoreFile(deleted.storagePath);
    // 候选查询只应返回软删行；混入未删行时由事务内复核兜底
    repo.find.mockResolvedValue([pending, bound, deleted]);
    expect(await service.sweepDeletedFiles()).toBe(1);
    expect(existsSync(join(tmpDir, pending.storagePath))).toBe(true);
    expect(existsSync(join(tmpDir, bound.storagePath))).toBe(true);
    expect(existsSync(join(tmpDir, deleted.storagePath))).toBe(false);
  });
});
