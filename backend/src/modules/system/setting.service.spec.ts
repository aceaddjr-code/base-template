import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from './setting.service';
import { SysSetting } from './entities/sys-setting.entity';
import { SystemLogService } from './system-log.service';

describe('SettingService', () => {
  let service: SettingService;
  let repo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let logWrite: jest.Mock;

  beforeEach(async () => {
    repo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), save: jest.fn(), update: jest.fn() };
    logWrite = jest.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        SettingService,
        { provide: getRepositoryToken(SysSetting), useValue: repo },
        { provide: SystemLogService, useValue: { write: logWrite } },
      ],
    }).compile();
    service = module.get(SettingService);
  });

  it('listAll 按注册表输出，未修改的键返回默认值', async () => {
    const list = await service.listAll();
    expect(list.map((item) => item.key)).toEqual(['site.name', 'help.contact']);
    const site = list[0]!;
    expect(site.value).toBe('企业管理系统');
    expect(site.modified).toBe(false);
  });

  it('listAll 合并已存储取值并标记 modified', async () => {
    repo.find.mockResolvedValue([{ id: 3, key: 'site.name', value: '供应链平台', updatedAt: new Date('2026-10-22T00:00:00Z') }]);
    const list = await service.listAll();
    const site = list.find((item) => item.key === 'site.name')!;
    expect(site.value).toBe('供应链平台');
    expect(site.modified).toBe(true);
    const help = list.find((item) => item.key === 'help.contact')!;
    expect(help.modified).toBe(false);
  });

  it('listPublic 只返回公开键，未设置返回默认值', async () => {
    repo.find.mockResolvedValue([{ id: 3, key: 'site.name', value: '供应链平台' }]);
    const result = await service.listPublic();
    expect(result).toEqual({ 'site.name': '供应链平台', 'help.contact': '' });
  });

  it('未登记的键拒绝修改', async () => {
    await expect(service.updateValue('db.password', 'x', { id: 1 })).rejects.toMatchObject({ status: 404 });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('取值超长时带 value 字段路径拒绝', async () => {
    const error = await service.updateValue('site.name', '名'.repeat(51), { id: 1 }).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.response.fieldErrors).toEqual([{ path: 'value', code: 'maxlength', message: expect.any(String) }]);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('必填参数清空时拒绝', async () => {
    const error = await service.updateValue('site.name', '   ', { id: 1 }).catch((e) => e);
    expect(error.response.fieldErrors[0].code).toBe('required');
  });

  it('首次修改创建取值行并写审计', async () => {
    repo.save.mockResolvedValue({ id: 9, key: 'help.contact', value: 'support@example.com', updatedAt: new Date() });
    const view = await service.updateValue('help.contact', '  support@example.com  ', { id: 7, username: 'admin' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ key: 'help.contact', value: 'support@example.com' }));
    expect(view.value).toBe('support@example.com');
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', entityType: 'system_settings', entityDesc: 'help.contact' }));
  });

  it('再次修改更新原行，审计包含旧值', async () => {
    repo.findOne.mockResolvedValue({ id: 3, key: 'site.name', value: '旧名称' });
    const view = await service.updateValue('site.name', '新名称', { id: 7, username: 'admin' });
    expect(repo.update).toHaveBeenCalledWith(3, expect.objectContaining({ value: '新名称' }));
    expect(repo.save).not.toHaveBeenCalled();
    expect(view.modified).toBe(true);
    expect(logWrite).toHaveBeenCalledWith(expect.objectContaining({ detail: JSON.stringify({ old: { value: '旧名称' }, new: { value: '新名称' } }) }));
  });
});
