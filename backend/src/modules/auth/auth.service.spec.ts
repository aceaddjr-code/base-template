import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs');
const chain = (rows: unknown[] = []) => ({
  leftJoinAndSelect:jest.fn().mockReturnThis(), addSelect:jest.fn().mockReturnThis(),
  innerJoin:jest.fn().mockReturnThis(), select:jest.fn().mockReturnThis(),
  where:jest.fn().mockReturnThis(), getRawMany:jest.fn().mockResolvedValue(rows), getOne:jest.fn(),
});

describe('本地认证、菜单和权限缓存', () => {
  let service: AuthService;
  let users: any, roles: any, menus: any, links: any, scopes: any, targets: any, jwt: any, loginQuery: any, roleQuery: any;
  const account = { id:1, username:'alice', password:'hash', status:1, roleId:2, tokenVersion:1,
    displayName:'用户甲', deptId:3, role:{ id:2, name:'普通用户', code:'user' } };

  beforeEach(() => {
    jest.resetAllMocks();
    loginQuery = chain();
    loginQuery.getOne.mockResolvedValue(account);
    roleQuery = chain([{ roleId:2, code:'user' }]);
    users = { createQueryBuilder:jest.fn().mockReturnValue(loginQuery), findOne:jest.fn().mockResolvedValue(account) };
    roles = { findOne:jest.fn().mockResolvedValue(account.role), find:jest.fn() };
    menus = { find:jest.fn() };
    links = { createQueryBuilder:jest.fn().mockReturnValue(roleQuery), manager:{ query:jest.fn().mockResolvedValue([]) } };
    scopes = { find:jest.fn().mockResolvedValue([]) };
    targets = { find:jest.fn().mockResolvedValue([]) };
    jwt = { sign:jest.fn().mockReturnValue('signed-token') };
    service = new AuthService(jwt,users,roles,menus,links,scopes,targets);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it('正确密码签发令牌，响应中不返回密码', async () => {
    const result = await service.login('alice','password');
    expect(bcrypt.compare).toHaveBeenCalledWith('password','hash');
    expect(result.token).toBe('signed-token');
    expect(result.user).not.toHaveProperty('password');
    expect(jwt.sign.mock.calls[0][0].dataScopes).toEqual([
      { scopeKey:'__global__', scopeType:'self', viewOthers:1, editOthers:0, deleteOthers:0, targets:[] },
    ]);
  });

  it.each([null, { ...account, password:null }])('缺少本地密码的账号不能登录', async user => {
    loginQuery.getOne.mockResolvedValue(user);
    await expect(service.login('alice','password')).rejects.toThrow(UnauthorizedException);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('错误密码不能签发令牌', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(service.login('alice','wrong')).rejects.toThrow('账号或密码错误');
  });

  it('停用账号不能登录', async () => {
    loginQuery.getOne.mockResolvedValue({ ...account,status:0 });
    await expect(service.login('alice','password')).rejects.toThrow(ForbiddenException);
  });

  it('用户的表单范围和目标随登录签发', async () => {
    scopes.find.mockResolvedValue([{ id:11, scopeKey:'example-items', scopeType:'by_users', viewOthers:1,editOthers:1,deleteOthers:0 }]);
    targets.find.mockResolvedValue([{ userDataScopeId:11,targetId:7 }]);
    await service.login('alice','password');
    expect(jwt.sign.mock.calls[0][0].dataScopes[0]).toMatchObject({ scopeKey:'example-items',targets:[7],editOthers:1 });
  });

  it('权限变化后的 tokenVersion 使用新的缓存键', async () => {
    users.findOne.mockResolvedValueOnce({ id:1,status:1,tokenVersion:1 }).mockResolvedValueOnce({ id:1,status:1,tokenVersion:2 });
    links.manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ permission:'example-items:view' }]);
    await expect(service.getUserAccessCodes({ id:1 })).resolves.toEqual([]);
    await expect(service.getUserAccessCodes({ id:1 })).resolves.toEqual(['example-items:view']);
  });

  it('禁用账号不能通过后台权限查询得到授权', async () => {
    users.findOne.mockResolvedValue({ id:1,status:0,tokenVersion:2 });
    await expect(service.getUserAccessCodes({ id:1 })).resolves.toEqual([]);
  });

  it('已授权子菜单自动补全父菜单，并排除停用菜单和按钮', async () => {
    const root = { id:10,parentId:null,path:'/examples',name:'示例业务',type:'menu',status:1,sort:1 };
    const child = { id:11,parentId:10,path:'/examples/items',name:'示例事项',type:'menu',status:1,sort:1 };
    const disabled = { id:12,parentId:10,type:'menu',status:0 };
    const button = { id:13,parentId:11,type:'button',status:1 };
    roles.find.mockResolvedValue([{ menus:[child,disabled,button] }]);
    menus.find.mockResolvedValue([root,child,button]);
    const result = await service.getUserMenus([2]);
    expect(result).toHaveLength(1);
    expect(result[0].children.map((item:any) => item.path)).toEqual(['/examples/items']);
  });

  it('没有角色的账号菜单为空', async () => {
    await expect(service.getUserMenus([])).resolves.toEqual([]);
  });

  it('管理员自动可见新增菜单，无需重跑初始化', async () => {
    roles.find.mockResolvedValue([{code:'admin',menus:[]}]);
    menus.find.mockResolvedValue([{id:20,parentId:null,name:'新增页面',path:'/new-page',type:'menu',status:1,sort:1}]);
    expect((await service.getUserMenus([1]))[0].path).toBe('/new-page');
  });

  it('停用主角色不能通过 roleCode 兜底恢复管理员资格', async () => {
    loginQuery.getOne.mockResolvedValue({...account,role:{id:1,code:'admin'}});
    roleQuery.getRawMany.mockResolvedValue([]);
    roles.findOne.mockResolvedValue(null);
    const result = await service.login('alice','password');
    expect(jwt.sign.mock.calls[0][0]).toMatchObject({roles:[],roleCode:'user'});
    expect(result.user.role).toBeNull();
  });
});
