import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { UserRole } from '../user/user-role.entity';
import { UserDataScopeService } from '../user/user-data-scope.service';
import { type UserScopeEntry } from '../../common/utils/data-scope';
import { getUserId } from '../../common/utils/service-helpers';

export interface EffectiveIdentity {
  roles: string[];
  roleIds: number[];
  dataScopes: UserScopeEntry[];
}

/**
 * 身份与权限解析（架构深化：从 AuthService 提取）。
 *
 * 深模块：小接口（resolve / accessCodes）承载大量行为
 * （主角色排序、admin 全局范围、附加角色并集、权限码缓存、版本失效）。
 *
 * 消费者：AuthService（登录/签发/资料）、PermissionExplanationService（解释）。
 * 运行时守卫经 AuthService 委托使用同一实现。
 */
@Injectable()
export class IdentityService {
  private readonly accessCodesCache = new Map<string, string[]>();

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Menu)
    private menuRepo: Repository<Menu>,
    @InjectRepository(UserRole)
    private userRoleRepo: Repository<UserRole>,
    private readonly userDataScopeService: UserDataScopeService,
  ) {}

  /**
   * 解析用户的有效身份：启用角色列表（主角色排首）、角色 ID 列表、数据范围。
   * admin 角色获得全局范围；其他角色经 UserDataScopeService 加载。
   */
  async resolveUserPermission(user: User): Promise<EffectiveIdentity> {
    const roleRows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin('roles', 'r', 'r.id = ur.role_id AND r.deleted_at IS NULL AND r.status = 1')
      .select(['r.id AS roleId', 'r.code AS code'])
      .where('ur.user_id = :userId AND ur.deleted_at IS NULL', { userId: user.id })
      .getRawMany();

    const codes = roleRows.map((r) => r.code as string);
    // 主角色排最前
    if (user.roleId != null) {
      const main = await this.roleRepo.findOne({ where: { id: user.roleId, status: 1 } });
      if (main) {
        const rest = codes.filter((c) => c !== main.code);
        codes.splice(0, codes.length, main.code, ...rest);
      }
    }
    const dataScopes: UserScopeEntry[] = codes.includes('admin')
      ? [
          {
            scopeKey: '__global__',
            scopeType: 'all',
            viewOthers: 1,
            editOthers: 1,
            deleteOthers: 1,
            targets: [],
          },
        ]
      : await this.userDataScopeService.loadForSession(user.id);

    return { roles: codes, roleIds: roleRows.map((r) => Number(r.roleId)), dataScopes };
  }

  /**
   * 按用户 ID 构造与登录签发一致的有效身份。
   * 无任何启用角色时按 generateToken 的 roleCode 缺省口径回退 'user'，
   * 与运行时权限码解析同源。
   */
  async buildEffectiveIdentity(userId: number): Promise<EffectiveIdentity> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, username: true, roleId: true, deptId: true },
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    const identity = await this.resolveUserPermission(user);
    if (!identity.roles.length) identity.roles = ['user'];
    return identity;
  }

  /**
   * 获取用户的有效权限码（admin 自动拥有全部按钮码；其他角色按菜单授权）。
   * 缓存以 userId:tokenVersion 为键，版本递增自动失效。
   */
  async getUserAccessCodes(user: any): Promise<string[]> {
    const userId = getUserId(user);
    if (userId == null) return [];
    // 后台服务有时只传目标用户 ID。这类调用没有 JWT 中的 tokenVersion，
    // 若固定缓存为 `${userId}:`，角色授权后会永久命中旧结果。先读取账号当前
    // 版本，使角色菜单变更触发的 tokenVersion 递增同样能让后台资格校验切换到新缓存。
    let tokenVersion = (user as any)?.tokenVersion;
    if (tokenVersion == null) {
      const current = await this.userRepo.findOne({
        where: { id: userId },
        select: { id: true, status: true, tokenVersion: true },
      });
      if (!current || Number(current.status) !== 1) return [];
      tokenVersion = current.tokenVersion;
    }
    const cacheKey = `${userId}:${tokenVersion}`;
    const cached = this.accessCodesCache.get(cacheKey);
    if (cached) return cached;
    this.pruneAccessCodesCache();
    const roleRows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .innerJoin('roles', 'r', 'r.id = ur.role_id AND r.deleted_at IS NULL AND r.status = 1')
      .select('r.id', 'roleId')
      .addSelect('r.code', 'code')
      .where('ur.user_id = :userId AND ur.deleted_at IS NULL', { userId })
      .getRawMany();
    let roleIds = roleRows.map((r) => Number(r.roleId));
    const roleCodes = roleRows.map((r) => r.code as string);
    if (!roleIds.length && (user as any)?.roleCode) {
      const main = await this.roleRepo.findOne({
        where: { code: (user as any).roleCode, status: 1 },
      });
      if (main) {
        roleIds = [main.id];
        roleCodes.push(main.code);
      }
    }
    if (!roleIds.length) return [];
    // admin 自动拥有全部按钮权限码（与数据范围 all 同惯例，避免首次配码前 admin 被 403）
    if (roleCodes.includes('admin')) {
      const allButtons = await this.menuRepo.find({ where: { type: 'button', status: 1 } });
      const codes = [...new Set(allButtons.map((m) => m.permission).filter((p): p is string => !!p))];
      this.accessCodesCache.set(cacheKey, codes);
      this.pruneAccessCodesCache();
      return codes;
    }
    const rows = (await this.userRoleRepo.manager.query(
      `SELECT DISTINCT m.permission AS permission
       FROM role_menus rm
       INNER JOIN menus m ON m.id = rm.menu_id
         AND m.deleted_at IS NULL AND m.status = 1 AND m.type = 'button'
       WHERE rm.role_id IN (?) AND m.permission IS NOT NULL AND m.permission <> ''`,
      [roleIds],
    )) as { permission: string }[];
    const codes = [...new Set(rows.map((r) => r.permission))];
    this.accessCodesCache.set(cacheKey, codes);
    this.pruneAccessCodesCache();
    return codes;
  }

  private pruneAccessCodesCache(limit = 1000) {
    if (this.accessCodesCache.size <= limit) return;
    const it = this.accessCodesCache.keys();
    while (this.accessCodesCache.size > limit) {
      const { value, done } = it.next();
      if (done) break;
      this.accessCodesCache.delete(value);
    }
  }
}
