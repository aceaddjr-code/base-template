import { ConfigService } from '@nestjs/config';
import { SystemLogService } from './system-log.service';
import { requestContext } from '../../common/utils/request-context';

describe('审计写入与保留策略', () => {
  it('手工记录也统一关联请求号并脱敏，失败不影响业务且不打印原异常', async () => {
    const repo = { create: jest.fn(value => value), save: jest.fn().mockResolvedValue({}) };
    const service = new SystemLogService(repo as any, new ConfigService());
    await requestContext.run({ requestId: 'audit-123' }, () => service.write({ action: 'update', detail: JSON.stringify({ new: { password: 'private', title: '有效标题' } }) }));
    const detail = repo.save.mock.calls[0][0].detail;
    expect(JSON.parse(detail)).toMatchObject({ requestId: 'audit-123', new: { title: '有效标题', password: '[REDACTED]' } });
    repo.save.mockRejectedValueOnce(new Error('database password=private'));
    await expect(service.write({ action: 'delete' })).resolves.toBeUndefined();
  });
  it('默认不清理，启用后只删除过期查询得到的受限批次', async () => {
    const qb: any = { withDeleted: () => qb, select: () => qb, where: jest.fn(() => qb), orderBy: () => qb, take: jest.fn(() => qb), getRawMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) };
    const repo = { createQueryBuilder: jest.fn(() => qb), delete: jest.fn().mockResolvedValue({ affected: 2 }) };
    const disabled = new SystemLogService(repo as any, new ConfigService());
    expect(await disabled.purgeExpired()).toBe(0);
    expect(repo.delete).not.toHaveBeenCalled();
    const enabled = new SystemLogService(repo as any, new ConfigService({ AUDIT_RETENTION_DAYS: 30 }));
    expect(await enabled.purgeExpired()).toBe(2);
    expect(qb.where).toHaveBeenCalledWith('l.createdAt < :cutoff', { cutoff: expect.any(Date) });
    expect(qb.take).toHaveBeenCalledWith(1000);
    expect(repo.delete).toHaveBeenCalledWith([1, 2]);
  });
});
