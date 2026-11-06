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
  let users: any, roles: any, menus: any, links: any, userDataScopes: any, jwt: any, rateLimit: any, logService: any, identity: any, loginQuery: any, roleQuery: any;
  const defaultScope = { scopeKey:'__global__', scopeType:'self', viewOthers:1, editOthers:0, deleteOthers:0, targets:[] };
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
    userDataScopes = { loadForSession:jest.fn().mockResolvedValue([defaultScope]) };
    jwt = { sign:jest.fn().mockReturnValue('signed-token') };
    rateLimit = {
      reserveIpBucket: jest.fn().mockResolvedValue({ allowed: true, observedWindow: new Date('2026-11-04T00:00:00Z') }),
      reserveAccountBucket: jest.fn().mockResolvedValue({ allowed: true, observedWindow: new Date('2026-11-04T00:00:00Z') }),
      recordAccountFailure: jest.fn().mockResolvedValue(undefined),
      recordAccountSuccess: jest.fn().mockResolvedValue(undefined),
    };
    logService = { write: jest.fn(async () => undefined), writeInTransaction: jest.fn(async () => undefined) };
    identity = {
      resolveUserPermission: jest.fn(async () => ({ roles: ['user'], roleIds: [2], dataScopes: [defaultScope] })),
      buildEffectiveIdentity: jest.fn(async () => ({ roles: ['user'], roleIds: [2], dataScopes: [defaultScope] })),
      getUserAccessCodes: jest.fn(async () => []),
    };
    service = new AuthService(jwt,users,roles,menus,links,userDataScopes,rateLimit,logService,identity);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it('正确密码签发令牌，响应中不返回密码', async () => {
    const result = await service.login('alice','password');
    expect(bcrypt.compare).toHaveBeenCalledWith('password','hash');
    expect(result.token).toBe('signed-token');
    expect(result.user).not.toHaveProperty('password');
    expect(jwt.sign.mock.calls[0][0].dataScopes).toEqual([defaultScope]);
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

  it('联合限流：先 IP 后账号，预占通过才校验密码，成功后复位账号计数', async () => {
    await service.login('alice','password','203.0.113.5');
    expect(rateLimit.reserveIpBucket).toHaveBeenCalledWith('203.0.113.5');
    expect(rateLimit.reserveAccountBucket).toHaveBeenCalledWith('acct:1', expect.any(Date), { ip:'203.0.113.5' });
    expect(rateLimit.reserveIpBucket.mock.invocationCallOrder[0]).toBeLessThan(rateLimit.reserveAccountBucket.mock.invocationCallOrder[0]);
    expect(bcrypt.compare).toHaveBeenCalledWith('password','hash');
    expect(rateLimit.recordAccountSuccess).toHaveBeenCalledWith('acct:1', expect.any(Date));
    expect(rateLimit.recordAccountFailure).not.toHaveBeenCalled();
  });

  it('IP 桶拒绝抛 429 稳定业务码，不查账号不做密码校验', async () => {
    rateLimit.reserveIpBucket.mockResolvedValueOnce({ allowed:false, rejectedBy:'window', retryAfterSeconds:30 });
    const error:any = await service.login('alice','password','1.2.3.4').catch(e => e);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({ reason:'LOGIN_RATE_LIMITED', retryAfterSeconds:30 });
    expect(rateLimit.reserveAccountBucket).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('账号桶拒绝抛 429，不做密码校验', async () => {
    rateLimit.reserveAccountBucket.mockResolvedValueOnce({ allowed:false, rejectedBy:'backoff', retryAfterSeconds:300 });
    const error:any = await service.login('alice','password','1.2.3.4').catch(e => e);
    expect(error.getStatus()).toBe(429);
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('未知账号用不可逆键计数并做等成本校验，随后记一次失败', async () => {
    loginQuery.getOne.mockResolvedValue(null);
    await expect(service.login('ghost','whatever','1.2.3.4')).rejects.toThrow('账号或密码错误');
    expect(rateLimit.reserveAccountBucket).toHaveBeenCalledWith(expect.stringMatching(/^acct:pending:[0-9a-f]{64}$/), expect.any(Date), { ip:'1.2.3.4' });
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(rateLimit.recordAccountFailure).toHaveBeenCalledTimes(1);
    expect(rateLimit.recordAccountSuccess).not.toHaveBeenCalled();
  });

  it('错误密码记一次失败；停用账号凭据正确时不计失败也不清计数', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(service.login('alice','wrong','1.2.3.4')).rejects.toThrow('账号或密码错误');
    expect(rateLimit.recordAccountFailure).toHaveBeenCalledWith('acct:1');
    rateLimit.recordAccountFailure.mockClear();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    loginQuery.getOne.mockResolvedValue({ ...account,status:0 });
    await expect(service.login('alice','password','1.2.3.4')).rejects.toThrow(ForbiddenException);
    expect(rateLimit.recordAccountFailure).not.toHaveBeenCalled();
    expect(rateLimit.recordAccountSuccess).not.toHaveBeenCalled();
  });

  it('待改密账号登录：签发受限会话，仅返回最小身份与待改密标志', async () => {
    loginQuery.getOne.mockResolvedValue({ ...account, mustChangePassword:1, temporaryPasswordExpiresAt:new Date(Date.now()+3600000) });
    const result = await service.login('alice','password','1.2.3.4');
    expect(result.token).toBe('signed-token');
    expect(result.user).toEqual({ id:1, username:'alice', displayName:'用户甲', mustChangePassword:true });
    expect(result.user).not.toHaveProperty('email');
    expect(result.user).not.toHaveProperty('roles');
  });

  it('临时密码过期登录：凭据正确也不签发会话，返回稳定业务码', async () => {
    loginQuery.getOne.mockResolvedValue({ ...account, mustChangePassword:1, temporaryPasswordExpiresAt:new Date(Date.now()-1000) });
    const error:any = await service.login('alice','password','1.2.3.4').catch(e => e);
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ reason:'TEMPORARY_PASSWORD_EXPIRED' });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('待改密标志缺失到期时间视为过期；受限 profile 仅返回最小身份', async () => {
    loginQuery.getOne.mockResolvedValue({ ...account, mustChangePassword:1, temporaryPasswordExpiresAt:null });
    const error:any = await service.login('alice','password','1.2.3.4').catch(e => e);
    expect(error.getStatus()).toBe(401);
    users.findOne.mockResolvedValue({ id:1, username:'alice', displayName:'用户甲', status:1 });
    const profile = await service.getProfile({ ...account, sub:1, mustChangePassword:true } as any);
    expect(profile).toEqual({ id:1, username:'alice', displayName:'用户甲', mustChangePassword:true });
    expect(users.findOne).toHaveBeenCalledWith(expect.objectContaining({ select:{ id:true, username:true, displayName:true, status:true } }));
  });

  it('用户的表单范围和目标随登录签发', async () => {
    // resolveUserPermission 委托 IdentityService；验证委托结果进入 JWT payload
    identity.resolveUserPermission.mockResolvedValueOnce({
      roles: ['user'], roleIds: [2],
      dataScopes: [{ scopeKey:'example-items', scopeType:'by_users', viewOthers:1, editOthers:1, deleteOthers:0, targets:[7] }],
    });
    await service.login('alice','password');
    expect(identity.resolveUserPermission).toHaveBeenCalled();
    expect(jwt.sign.mock.calls[0][0].dataScopes[0]).toMatchObject({ scopeKey:'example-items',targets:[7],editOthers:1 });
  });

  it('权限变化后的 tokenVersion 使用新的缓存键（IdentityService 委托验证）', async () => {
    // 权限码解析逻辑在 IdentityService；AuthService 验证委托透传
    identity.getUserAccessCodes.mockResolvedValueOnce([]).mockResolvedValueOnce(['example-items:view']);
    await expect(service.getUserAccessCodes({ id:1 })).resolves.toEqual([]);
    await expect(service.getUserAccessCodes({ id:1 })).resolves.toEqual(['example-items:view']);
    expect(identity.getUserAccessCodes).toHaveBeenCalledTimes(2);
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
    // resolveUserPermission 委托 IdentityService：模拟主角色停用（无启用角色）
    identity.resolveUserPermission.mockResolvedValueOnce({ roles: [], roleIds: [], dataScopes: [] });
    const result = await service.login('alice','password');
    expect(jwt.sign.mock.calls[0][0]).toMatchObject({roles:[],roleCode:'user'});
    expect(result.user.role).toBeNull();
  });
});
