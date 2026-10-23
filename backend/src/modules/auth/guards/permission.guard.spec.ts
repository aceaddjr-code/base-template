import { ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permission.decorator';
import { CRUD_PERM_PREFIX_KEY, resolveCrudPermCode } from '../../../common/decorators/crud-perm-prefix.decorator';

/** 构造最小 ExecutionContext：handler（方法名 + 元数据）+ class（类级元数据）+ user */
function makeContext(opts: {
  handlerName: string;
  handlerPermissions?: string[];
  classPrefix?: string;
  user?: { sub: number } | null;
}) {
  const handler = { name: opts.handlerName };
  const reflector = {
    getAllAndOverride: jest.fn((key: string, targets: unknown[]) => {
      if (key === PERMISSIONS_KEY) {
        // 模拟 Nest 行为：先 handler 后 class，handler 有值则覆盖
        return opts.handlerPermissions;
      }
      return undefined;
    }),
    get: jest.fn((key: string, target: unknown) => {
      if (key === CRUD_PERM_PREFIX_KEY) return opts.classPrefix;
      return undefined;
    }),
  } as any;
  const authService = {
    getUserAccessCodes: jest.fn().mockResolvedValue(['example-items:create']),
  } as any;
  const context = {
    getHandler: () => handler,
    getClass: () => class ExampleController {},
    switchToHttp: () => ({ getRequest: () => ({ user: opts.user === null ? undefined : (opts.user ?? { sub: 1 }) }) }),
  } as unknown as ExecutionContext;
  return { guard: new PermissionGuard(reflector, authService), context, reflector, authService };
}

describe('PermissionGuard', () => {
  it.each(['list', 'findOne', 'distinctValues'])('读取方法 %s 必须具备 view 权限', async handlerName => {
    const { guard, context, authService } = makeContext({ handlerName, classPrefix:'example-items' });
    authService.getUserAccessCodes.mockResolvedValue([]);
    expect(await guard.canActivate(context)).toBe(false);
    authService.getUserAccessCodes.mockResolvedValue(['example-items:view']);
    expect(await guard.canActivate(context)).toBe(true);
  });
  it('显式 @RequirePermission 优先于 @CrudPermPrefix（用户有前缀码但无显式码 → 拒绝）', async () => {
    const { guard, context, authService } = makeContext({
      handlerName: 'create',
      handlerPermissions: ['custom:create'],
      classPrefix: 'example-items',
    });
    // 用户只有 example-items:create（前缀映射码），无 custom:create → 证明走的是显式码
    expect(await guard.canActivate(context)).toBe(false);
  });

  it('无显式权限码时按前缀 + 方法名映射（create → :create）', async () => {
    const { guard, context, authService } = makeContext({ handlerName: 'create', classPrefix: 'example-items' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(authService.getUserAccessCodes).toHaveBeenCalled();
  });

  it('方法名映射：remove → :delete、importExcel → :import、exportExcel → :export', () => {
    expect(resolveCrudPermCode('p', 'remove')).toBe('p:delete');
    expect(resolveCrudPermCode('p', 'importExcel')).toBe('p:import');
    expect(resolveCrudPermCode('p', 'exportExcel')).toBe('p:export');
    expect(resolveCrudPermCode('p', 'update')).toBe('p:update');
  });

  it('标准端点但用户无对应权限码 → 403（false）', async () => {
    const { guard, context, authService } = makeContext({ handlerName: 'remove', classPrefix: 'example-items' });
    (authService.getUserAccessCodes as jest.Mock).mockResolvedValue(['other:code']);
    expect(await guard.canActivate(context)).toBe(false);
  });

  it('非标准端点（stats/自定义动词）且无前缀 → 放行', async () => {
    const { guard, context, authService } = makeContext({ handlerName: 'stats' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(authService.getUserAccessCodes).not.toHaveBeenCalled();
  });

  it('有前缀但方法名不在映射表（stats）→ 放行', async () => {
    const { guard, context, authService } = makeContext({ handlerName: 'stats', classPrefix: 'example-items' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(authService.getUserAccessCodes).not.toHaveBeenCalled();
  });

  it('无 user → 拒绝（带权限要求的端点）', async () => {
    const { guard, context } = makeContext({ handlerName: 'create', classPrefix: 'example-items', user: null });
    expect(await guard.canActivate(context)).toBe(false);
  });
});
