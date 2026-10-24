import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
  let repo: { save: jest.Mock; findOne: jest.Mock; find: jest.Mock; remove: jest.Mock };
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
      mimeType: 'application/pdf', size: 10, status: 'temp',
      entityType: null, entityId: null, createdBy: 7, createdAt: new Date(), ...overrides,
    };
    rows.set(id, row);
    return row;
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
    };
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

  it('保存附件:非法扩展名拒绝,合法则落 temp 行并写审计', async () => {
    await expect(service.saveFile({ originalname: 'a.exe', mimetype: 'application/x-exe', size: 10, filename: '1-x.exe' } as any, uploader))
      .rejects.toMatchObject({ status: 400 });
    const view = await service.saveFile({ originalname: '报价单.pdf', mimetype: 'application/pdf', size: 100, filename: '1-q.pdf' } as any, uploader);
    expect(view.status).toBe('temp');
    expect(view.mine).toBe(true);
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entityType: 'attachments' }));
  });

  it('temp 下载仅上传者/管理员;文件丢失返回 503', async () => {
    const row = await seedRow();
    writeStoreFile(row.storagePath);
    const resolved = await service.resolveForDownload(row.id, uploader);
    expect(resolved.row.id).toBe(row.id);
    await expect(service.resolveForDownload(row.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 404 });
    await expect(service.resolveForDownload(row.id, admin)).resolves.toBeDefined();
    rows.set(row.id, { ...row, storagePath: '2026/10/missing.pdf' });
    rows.get(row.id).storagePath = '2026/10/missing.pdf';
    await expect(service.resolveForDownload(row.id, uploader)).rejects.toMatchObject({ status: 503 });
  });

  it('已绑定附件同样仅上传者/管理员可下载（业务可见性裁决随子表声明式接入演进，ADR-0001）', async () => {
    const bound = await seedRow({ status: 'bound', entityType: 'example-items', entityId: 9 });
    writeStoreFile(bound.storagePath);
    await expect(service.resolveForDownload(bound.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 404 });
    await expect(service.resolveForDownload(bound.id, uploader)).resolves.toBeDefined();
    await expect(service.resolveForDownload(bound.id, admin)).resolves.toBeDefined();
  });

  it('删除移除磁盘文件与行;非上传者不可删除 bound 附件且文件保留', async () => {
    const row = await seedRow();
    writeStoreFile(row.storagePath);
    const result = await service.remove(row.id, uploader);
    expect(result.message).toBe('删除成功');
    expect(existsSync(join(tmpDir, row.storagePath))).toBe(false);
    expect(rows.has(row.id)).toBe(false);
    const bound = await seedRow({ status: 'bound', entityType: 'example-items', entityId: 1, createdBy: 1 });
    writeStoreFile(bound.storagePath);
    await expect(service.remove(bound.id, { sub: 8, username: 'x', roleCode: 'user' } as any)).rejects.toMatchObject({ status: 404 });
    expect(existsSync(join(tmpDir, bound.storagePath))).toBe(true);
  });

  it('清理只移除过期 temp,保留新行与 bound 行', async () => {
    const oldTemp = await seedRow({ createdAt: new Date(Date.now() - 48 * 3600_000) });
    writeStoreFile(oldTemp.storagePath);
    const freshTemp = await seedRow();
    writeStoreFile(freshTemp.storagePath);
    const oldBound = await seedRow({ status: 'bound', entityType: 'spec_entity', entityId: 1, createdAt: new Date(Date.now() - 48 * 3600_000) });
    writeStoreFile(oldBound.storagePath);
    // 模拟数据库按 status/temp 与 createdAt 过滤后只返回过期行
    repo.find.mockResolvedValue([oldTemp]);
    const removed = await service.sweepExpiredTemp(24);
    expect(removed).toBe(1);
    expect(existsSync(join(tmpDir, oldTemp.storagePath))).toBe(false);
    expect(existsSync(join(tmpDir, freshTemp.storagePath))).toBe(true);
    expect(existsSync(join(tmpDir, oldBound.storagePath))).toBe(true);
  });
});
