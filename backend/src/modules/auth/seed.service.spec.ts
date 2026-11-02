import { ConfigService } from '@nestjs/config';
import { SeedService } from './seed.service';
import { User } from '../user/user.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { SysDictType } from '../system/entities/sys-dict-type.entity';
import { SysDictItem } from '../system/entities/sys-dict-item.entity';
import * as bcrypt from 'bcryptjs';

describe('空库初始化', () => {
  function setup(existing = false, password = 'test-password-123') {
    let nextId=1;
    const manager:any={
      count:jest.fn(async (entity:any) => existing && entity === User ? 1 : 0),
      save:jest.fn(async (_entity:any,data:any) => Array.isArray(data) ? data : ({...data,id:nextId++})),
    };
    const source:any={transaction:jest.fn(async (run:any) => run(manager))};
    const config=new ConfigService({ADMIN_DEFAULT_PASSWORD:password});
    return {service:new SeedService(source,config),manager};
  }

  it('已有用户的库重启不修改任何数据，包括已删除用户', async () => {
    const {service,manager}=setup(true);
    await service.onModuleInit();
    expect(manager.count).toHaveBeenCalledWith(User,{withDeleted:true});
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('已有角色配置的库不重建菜单或覆盖授权', async () => {
    const {service,manager}=setup();
    manager.count.mockImplementation(async (entity:any) => entity === Role ? 1 : 0);
    await service.onModuleInit();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('空库先检查管理员密码再写任何配置', async () => {
    const {service,manager}=setup(false,'12');
    await expect(service.onModuleInit()).rejects.toThrow('ADMIN_DEFAULT_PASSWORD');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('空库允许三位初始密码并仍以 bcrypt 保存', async () => {
    const {service,manager}=setup(false,'123');
    await service.onModuleInit();
    const admin=manager.save.mock.calls.find(([entity]:any[]) => entity === User)[1];
    expect(admin.password).not.toBe('123');
    expect(await bcrypt.compare('123',admin.password)).toBe(true);
  });

  it('空库创建本地管理员和完整的示例读写权限', async () => {
    const {service,manager}=setup();
    await service.onModuleInit();
    const admin=manager.save.mock.calls.find(([entity]:any[]) => entity === User)[1];
    expect(admin.password).not.toBe('test-password-123');
    const buttons=manager.save.mock.calls.filter(([entity]:any[]) => entity === Menu).map(([,data]:any[]) => data.permission).filter(Boolean);
    expect(buttons).toEqual(expect.arrayContaining(['example-items:view','example-items:create','example-items:update','example-items:delete','example-items:import','example-items:export']));
    const notificationTypeIndex = manager.save.mock.calls.findIndex(([entity, data]: any[]) => entity === SysDictType && data.code === 'notification_type');
    const notificationType = await manager.save.mock.results[notificationTypeIndex].value;
    expect(manager.save.mock.calls.some(([entity, data]: any[]) => entity === SysDictItem && data.typeId === notificationType.id && data.value === 'system' && data.label === '系统通知')).toBe(true);
    const secondWriteCount=manager.save.mock.calls.length;
    manager.count.mockResolvedValue(1);
    await service.onModuleInit();
    expect(manager.save).toHaveBeenCalledTimes(secondWriteCount);
  });

  it('四类管理权限挂在对应页面，默认业务角色不获得全站管理资格', async () => {
    const { service, manager } = setup();
    await service.onModuleInit();
    const savedMenus = await Promise.all(manager.save.mock.calls.flatMap(([entity]: any[], index: number) => entity === Menu ? [manager.save.mock.results[index].value] : []));
    const expected: Record<string, string[]> = {
      announcements: ['announcements:view', 'announcements:create', 'announcements:update', 'announcements:publish', 'announcements:withdraw', 'announcements:delete'],
      dict: ['dicts:view', 'dicts:create', 'dicts:update', 'dicts:delete'],
      logs: ['system-logs:view'],
      attachments: ['attachments:view', 'attachments:upload', 'attachments:download', 'attachments:delete', 'attachments:cleanup'],
    };
    for (const [path, codes] of Object.entries(expected)) {
      const page = savedMenus.find(menu => menu.path === `/system/${path}`);
      expect(savedMenus.filter(menu => menu.parentId === page.id && menu.type === 'button').map(menu => menu.permission)).toEqual(codes);
    }
    const roles = manager.save.mock.calls.find(([entity, data]: any[]) => entity === Role && Array.isArray(data))[1];
    const normal = roles.find((role: Role) => role.code === 'user');
    expect(normal.menus.some((menu: Menu) => Object.values(expected).flat().includes(menu.permission!))).toBe(false);
  });

  it('公告、通知与附件入口挂在「工作协同」下，系统管理不再包含', async () => {
    const { service, manager } = setup();
    await service.onModuleInit();
    const savedMenus = await Promise.all(manager.save.mock.calls.flatMap(([entity]: any[], index: number) => entity === Menu ? [manager.save.mock.results[index].value] : []));
    const home = savedMenus.find((menu: any) => menu.path === '/home');
    const collaboration = savedMenus.find((menu: any) => menu.path === '/collaboration');
    const examples = savedMenus.find((menu: any) => menu.path === '/examples');
    const system = savedMenus.find((menu: any) => menu.path === '/system');
    expect(collaboration?.name).toBe('工作协同');
    // 紧挨首页下方：排序位于首页与示例业务之间
    expect(collaboration.sort).toBeGreaterThan(home.sort);
    expect(collaboration.sort).toBeLessThan(examples.sort);
    expect(savedMenus.filter((menu: any) => menu.parentId === collaboration.id && menu.type === 'menu').map((menu: any) => menu.path))
      .toEqual(['/system/announcements', '/system/notifications', '/system/attachments']);
    expect(savedMenus.filter((menu: any) => menu.parentId === system.id && menu.type === 'menu').map((menu: any) => menu.path))
      .toEqual(['/system/users', '/system/roles', '/system/menus', '/system/dict', '/system/logs', '/system/backups', '/system/settings']);
  });
});
