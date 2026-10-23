import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoleService } from './role.service';
import { Role } from './role.entity';
import { Menu } from '../menu/menu.entity';
import { UserRole } from '../user/user-role.entity';
import { User } from '../user/user.entity';

describe('RoleService 按钮权限缓存失效', () => {
  it('重新分配角色菜单后递增该角色全部用户的 tokenVersion', async () => {
    const role = { id: 17, code: 'custom_role', menus: [] } as any;
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const whereInIds = jest.fn().mockReturnValue({ execute });
    const set = jest.fn().mockReturnValue({ whereInIds });
    const update = jest.fn().mockReturnValue({ set });
    const userRepo = {
      find: jest.fn().mockResolvedValue([{ id: 2 }]),
      createQueryBuilder: jest.fn().mockReturnValue({ update }),
    };
    const userRoleRepo = {
      find: jest.fn().mockResolvedValue([{ userId: 2 }, { userId: 3 }]),
    };
    const roleRepo = {
      findOne: jest.fn().mockResolvedValue(role),
      save: jest.fn().mockResolvedValue(role),
      manager: {
        getRepository: jest.fn((entity) => entity === User ? userRepo : userRoleRepo),
      },
    };
    const menuRepo = { findBy: jest.fn().mockResolvedValue([{ id: 534 }]) };
    const module = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: roleRepo },
        { provide: getRepositoryToken(Menu), useValue: menuRepo },
      ],
    }).compile();
    const service = module.get(RoleService);

    await service.assignMenus(17, [534]);

    expect(set).toHaveBeenCalledWith({ tokenVersion: expect.any(Function) });
    expect(whereInIds).toHaveBeenCalledWith([2, 3]);
    expect(execute).toHaveBeenCalled();
  });
});
