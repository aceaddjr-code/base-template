import { ForbiddenException } from '@nestjs/common';
import { assertCanOperateOn, buildDataScope, canEditOwner, scopeWhereClause } from './data-scope';

describe('显式用户数据范围', () => {
  it('系统管理员不受记录范围限制', () => {
    expect(scopeWhereClause('t',{sub:1,roles:['admin']}).sql).toBeNull();
  });

  it('角色名称不推导部门资格，未配置范围时只可见本人', () => {
    const scope = scopeWhereClause('t',{sub:2,roleCode:'custom_admin',deptId:8});
    expect(scope.params).toEqual({scopeUserId:2});
    expect(canEditOwner({roleCode:'custom_admin'})).toBe(false);
    expect(canEditOwner({roleCode:'admin'})).toBe(true);
  });

  it('缺失身份时查询不到任何记录', () => {
    expect(scopeWhereClause('t',null).sql).toBe('1 = 0');
  });

  it('表单设置优先于全局设置，按用户范围始终包含本人', () => {
    const result = scopeWhereClause('t',{sub:2,dataScopes:[
      {scopeKey:'__global__',scopeType:'all'},
      {scopeKey:'example-items',scopeType:'by_users',targets:[7]},
    ]},'example-items');
    expect(result.params.scopeUserIds).toEqual([2,7]);
  });

  it('部门范围包含选定部门子树和本人', () => {
    const result = scopeWhereClause('t',{sub:2,dataScopes:[{scopeKey:'__global__',scopeType:'by_depts',targets:[8]}]});
    expect(result.sql).toContain('WITH RECURSIVE');
    expect(result.params).toEqual({scopeSelfUid:2,scopeDeptIds:[8]});
  });

  it('编辑权限开关不能扩大按用户配置的目标集合', () => {
    const user={sub:2,dataScopes:[{scopeKey:'example-items',scopeType:'by_users',targets:[7],editOthers:1}]};
    expect(() => assertCanOperateOn({ownerId:7},user,'example-items','edit')).not.toThrow();
    expect(() => assertCanOperateOn({ownerId:9},user,'example-items','edit')).toThrow(ForbiddenException);
    expect(() => assertCanOperateOn({ownerId:7},user,'example-items','delete')).toThrow(ForbiddenException);
  });

  it('有列表范围也需要查看他人详情的开关', () => {
    const user={sub:2,dataScopes:[{scopeKey:'__global__',scopeType:'all',viewOthers:0}]};
    expect(() => assertCanOperateOn({ownerId:7},user,'example-items','view')).toThrow(ForbiddenException);
    expect(() => assertCanOperateOn({ownerId:2},user,'example-items','view')).not.toThrow();
  });

  it('QueryBuilder 使用同一范围条件', () => {
    const qb:any={andWhere:jest.fn().mockReturnThis()};
    buildDataScope(qb,'t',{sub:4});
    expect(qb.andWhere).toHaveBeenCalledWith('t.ownerId = :scopeUserId',{scopeUserId:4});
  });
});
