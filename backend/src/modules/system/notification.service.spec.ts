import { IsNull } from 'typeorm';
import { NotificationService } from './notification.service';

describe('我的通知分页', () => {
  const repo = { findAndCount: jest.fn(), update: jest.fn(), count: jest.fn() };
  const service = new NotificationService(repo as any);
  beforeEach(() => jest.resetAllMocks());

  it('未读过滤与分页计数一起下推，且限定当前用户', async () => {
    repo.findAndCount.mockResolvedValue([[{ id: 8 }], 23]);
    await expect(service.findMine(7, 2, 10, 'unread')).resolves.toEqual({ list: [{ id: 8 }], total: 23, page: 2, pageSize: 10 });
    expect(repo.findAndCount).toHaveBeenCalledWith({ where: { userId: 7, readAt: IsNull() }, skip: 10, take: 10, order: { id: 'DESC' } });
  });

  it('全部模式不附加未读条件；标已读仍限定当前用户', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    await service.findMine(8);
    expect(repo.findAndCount.mock.calls[0][0].where).toEqual({ userId: 8 });
    await service.markRead(8, 99);
    expect(repo.update).toHaveBeenCalledWith({ userId: 8, id: 99 }, { readAt: expect.any(Date) });
  });
});
