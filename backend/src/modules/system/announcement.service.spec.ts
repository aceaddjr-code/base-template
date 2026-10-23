import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnnouncementService } from './announcement.service';
import { Announcement } from './entities/announcement.entity';
import { SystemLogService } from './system-log.service';

function announcement(id: number, status: Announcement['status'], overrides: Partial<Announcement> = {}): Announcement {
  return { id, title: `公告${id}`, content: '正文', status, publishedAt: null, publishedBy: null } as Announcement;
}

describe('AnnouncementService 状态流转', () => {
  let service: AnnouncementService;
  let repo: { createQueryBuilder: jest.Mock; findAndCount: jest.Mock; findOne: jest.Mock; save: jest.Mock; softDelete: jest.Mock };
  let logWrite: jest.Mock;

  beforeEach(async () => {
    repo = {
      createQueryBuilder: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (data) => ({ id: data.id ?? 9, ...data })),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    logWrite = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: getRepositoryToken(Announcement), useValue: repo },
        { provide: SystemLogService, useValue: { write: logWrite } },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  it('创建即草稿并写审计', async () => {
    const record = await service.create({ title: '  上线通知  ', content: '第一行\r\n第二行' }, { id: 7 });
    expect(record.status).toBe('draft');
    expect(record.title).toBe('上线通知');
    expect(record.content).toBe('第一行\n第二行');
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entityType: 'system_announcements', entityDesc: '上线通知' }));
  });

  it('纯空白标题/正文按字段路径拒绝，不落库', async () => {
    const titleError = await service.create({ title: '   ', content: '正文' }, { id: 7 }).catch((e) => e);
    expect(titleError.status).toBe(400);
    expect(titleError.response.fieldErrors).toEqual([{ path: 'title', code: 'required', message: '标题不能为空' }]);
    const contentError = await service.create({ title: '标题', content: '  \r\n ' }, { id: 7 }).catch((e) => e);
    expect(contentError.response.fieldErrors[0].path).toBe('content');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('仅草稿可编辑，已发布提示先撤回', async () => {
    repo.findOne.mockResolvedValue(announcement(1, 'published'));
    await expect(service.update(1, { title: '新标题', content: '新正文' }, { id: 7 })).rejects.toThrow('只有草稿可以编辑');
    repo.findOne.mockResolvedValue(announcement(1, 'draft'));
    const saved = await service.update(1, { title: '新标题', content: '新正文' }, { id: 7 });
    expect(saved.title).toBe('新标题');
  });

  it('草稿发布记录发布时间与发布人，重复发布拒绝', async () => {
    repo.findOne.mockResolvedValue(announcement(2, 'draft'));
    const saved = await service.publish(2, { id: 7 });
    expect(saved.status).toBe('published');
    expect(saved.publishedAt).toBeInstanceOf(Date);
    expect(saved.publishedBy).toBe(7);
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'publish' }));
    repo.findOne.mockResolvedValue(announcement(2, 'published'));
    await expect(service.publish(2, { id: 7 })).rejects.toThrow('只有草稿或已撤回的公告可以发布');
  });

  it('已撤回可重新发布并刷新发布时间', async () => {
    repo.findOne.mockResolvedValue(announcement(3, 'withdrawn', { publishedAt: new Date('2026-01-01') }));
    const saved = await service.publish(3, { id: 7 });
    expect(saved.status).toBe('published');
    expect(saved.publishedAt?.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
  });

  it('撤回仅对已发布开放，草稿撤回拒绝', async () => {
    repo.findOne.mockResolvedValue(announcement(4, 'draft'));
    await expect(service.withdraw(4, { id: 7 })).rejects.toThrow('只有已发布的公告可以撤回');
    repo.findOne.mockResolvedValue(announcement(4, 'published'));
    const saved = await service.withdraw(4, { id: 7 });
    expect(saved.status).toBe('withdrawn');
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'withdraw' }));
  });

  it('已发布不能删除，草稿与已撤回可以', async () => {
    repo.findOne.mockResolvedValue(announcement(5, 'published'));
    await expect(service.remove(5, { id: 7 })).rejects.toThrow('已发布的公告不能删除');
    expect(repo.softDelete).not.toHaveBeenCalled();
    repo.findOne.mockResolvedValue(announcement(5, 'draft'));
    await service.remove(5, { id: 7 });
    expect(repo.softDelete).toHaveBeenCalledWith(5);
  });

  it('非 admin 读取未公开详情按不存在处理', async () => {
    repo.findOne.mockResolvedValue(announcement(6, 'withdrawn'));
    await expect(service.readDetail(6, false)).rejects.toMatchObject({ status: 404 });
    await expect(service.readDetail(6, true)).resolves.toBeDefined();
    await expect(service.readDetail(NaN, true)).rejects.toMatchObject({ status: 404 });
  });

  it('已发布列表按发布时间倒序且只查 published', async () => {
    await service.findPublishedPage(1, 10);
    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'published' },
      order: { publishedAt: 'DESC', id: 'DESC' },
    }));
  });
});
