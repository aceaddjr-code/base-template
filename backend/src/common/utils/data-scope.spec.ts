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

  it('角色必须明确授权操作他人，授权不能扩大按用户配置的目标集合', () => {
    const user={sub:2,dataScopes:[{scopeKey:'example-items',scopeType:'by_users',targets:[7],editOthers:1}]};
    expect(() => assertCanOperateOn({ownerId:2},user,'example-items','edit')).not.toThrow();
    expect(() => assertCanOperateOn({ownerId:7},user,'example-items','edit')).toThrow('缺少编辑他人记录的角色权限');
    const editor = { ...user, accessCodes: ['example-items:update-others'] };
    expect(() => assertCanOperateOn({ownerId:7},editor,'example-items','edit')).not.toThrow();
    expect(() => assertCanOperateOn({ownerId:9},editor,'example-items','edit')).toThrow(ForbiddenException);
    expect(() => assertCanOperateOn({ownerId:7},editor,'example-items','delete')).toThrow(ForbiddenException);
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

  it('额外可见分支与共同范围 OR 叠加（原子包裹），all 档与管理员不叠加', () => {
    const extra = { sql: 'EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = t.id AND p.participant_id = :scopeParticipantUid)', params: { scopeParticipantUid: 5 } };
    const scoped = scopeWhereClause('t', { sub: 5, dataScopes: [{ scopeKey: 'example-items', scopeType: 'self' }] }, 'example-items', undefined, undefined, extra);
    // 整体原子包裹：调用方 andWhere 平铺拼接（t.id = :id AND <scope>）时顶层 OR 不得逃逸外层约束
    expect(scoped.sql).toBe('((t.ownerId = :scopeUserId) OR (EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = t.id AND p.participant_id = :scopeParticipantUid)))');
    expect(scoped.params).toEqual({ scopeUserId: 5, scopeParticipantUid: 5 });
    // all 档无过滤：extra 无需叠加
    expect(scopeWhereClause('t', { sub: 5, dataScopes: [{ scopeKey: 'example-items', scopeType: 'all' }] }, 'example-items', undefined, undefined, extra).sql).toBeNull();
    expect(scopeWhereClause('t', { sub: 1, roles: ['admin'] }, 'example-items', undefined, undefined, extra).sql).toBeNull();
  });

  it('操作维度下额外可见分支与共同范围、操作开关分别 OR（成员不绕过共同范围限定）', () => {
    const extra = { sql: 'EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = t.id AND p.participant_id = :scopeParticipantUid)', params: { scopeParticipantUid: 5 } };
    // 本人开关关、他人开关关：成员分支让成员记录经 gate 放行，非成员记录被 gate 拦下
    const user = { sub: 5, dataScopes: [{ scopeKey: 'example-items', scopeType: 'self', viewSelf: 0, viewOthers: 0 }] };
    const clause = scopeWhereClause('t', user, 'example-items', 'view', undefined, extra);
    expect(clause.sql).toBe('(((t.ownerId = :scopeUserId) OR (EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = t.id AND p.participant_id = :scopeParticipantUid)))) AND (((1 = 0) OR (EXISTS (SELECT 1 FROM record_participants p WHERE p.record_id = t.id AND p.participant_id = :scopeParticipantUid))))');
    expect(clause.params).toEqual({ scopeUserId: 5, scopeParticipantUid: 5 });
  });

  it('参与者放行不受本人/他人开关约束（含无归属人记录）', () => {
    const user = { sub: 5, dataScopes: [{ scopeKey: 'example-items', scopeType: 'self', viewSelf: 0, editSelf: 0, viewOthers: 0, editOthers: 0 }] };
    expect(() => assertCanOperateOn({ ownerId: 9 }, user, 'example-items', 'view')).toThrow('没有查看他人单据的权限');
    expect(() => assertCanOperateOn({ ownerId: 9 }, user, 'example-items', 'view', true)).not.toThrow();
    expect(() => assertCanOperateOn({ ownerId: null }, user, 'example-items', 'edit', true)).not.toThrow();
    // 非参与者照旧
    expect(() => assertCanOperateOn({ ownerId: null }, user, 'example-items', 'edit')).toThrow('该单据无归属人');
  });
});
