import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/user.entity';
import { Role } from '../role/role.entity';
import { Menu } from '../menu/menu.entity';
import { UserRole } from '../user/user-role.entity';
import { UserDataScopeService } from '../user/user-data-scope.service';
import { type UserScopeEntry } from '../../common/utils/data-scope';
import { getUserId } from '../../common/utils/service-helpers';
import type { JwtPayload } from './jwt.strategy';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginRateLimitService } from './login-rate-limit.service';
import { accountBucketKey, pendingAccountBucketKey } from './account-security.contracts';

/** 未知账号的等成本校验目标：惰性生成固定占位哈希，避免响应时间泄露账号是否存在。 */
let dummyCredentialHash: string | null = null;
function getDummyCredentialHash(): string {
  return (dummyCredentialHash ??= bcrypt.hashSync('account-security-invalid-credential', 10));
}

@Injectable()
export class AuthService {
  private readonly accessCodesCache = new Map<string, string[]>();

  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Menu)
    private menuRepo: Repository<Menu>,
    @InjectRepository(UserRole)
    private userRoleRepo: Repository<UserRole>,
    private readonly userDataScopeService: UserDataScopeService,
    private readonly rateLimit: LoginRateLimitService,
  ) {}

  /**
   * 本地账号登录，密码统一使用 bcrypt 验证。
   *
   * 联合限流（规格 3.1）：先 IP（跨账号累计、成功不清除），再账号（昂贵验证前
   * 原子预占、跨 IP 共用）；数据库故障由限流服务抛 503，不静默放行。账号等价性
   * 与登录查询同口径：已存在账号按稳定用户 ID 归并（utf8mb4_unicode_ci 大小写/
   * 重音不敏感），不存在账号用规范化输入的不可逆键并做等成本占位校验。
   */
  async login(loginid: string, password: string, clientIp?: string) {
    if (clientIp) {
      const ipDecision = await this.rateLimit.reserveIpBucket(clientIp);
      if (!ipDecision.allowed) throw LoginRateLimitService.rateLimitedError(ipDecision.retryAfterSeconds!);
    }
    const user = await this.userRepo.createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .addSelect('user.password')
      .where('user.username = :username', { username: loginid })
      .getOne();
    const bucketKey = user ? accountBucketKey(user.id) : pendingAccountBucketKey(loginid);
    const decision = await this.rateLimit.reserveAccountBucket(bucketKey, new Date(), { ip: clientIp });
    if (!decision.allowed) throw LoginRateLimitService.rateLimitedError(decision.retryAfterSeconds!);
    const passwordOk = user?.password
      ? await bcrypt.compare(password, user.password)
      : (await bcrypt.compare(password, getDummyCredentialHash()), false);
    if (!passwordOk) {
      await this.rateLimit.recordAccountFailure(bucketKey);
      throw new UnauthorizedException('账号或密码错误');
    }
    // 凭据正确但账号停用：不是猜测失败，不计连续失败，也不清成功计数。
    if (user!.status !== 1) throw new ForbiddenException('账号已被禁用');
    await this.rateLimit.recordAccountSuccess(bucketKey, decision.observedWindow);
    return this.generateToken(user!);
  }

  async getProfile(user: JwtPayload) {
    const full = await this.userRepo.findOne({
      where: { id: user.sub },
      relations: { role: true, dept: true },
    });

    if (!full) {
      throw new UnauthorizedException('用户不存在');
    }

    const roleCodes = user.roles ?? [user.roleCode];
    const roleIds = (user as any).roleIds ?? [];
    const menus = await this.getUserMenus(
      [full.roleId, ...roleIds].filter((x): x is number => x != null),
    );

    return {
      id: full.id,
      username: full.username,
      displayName: full.displayName,
      email: full.email,
      phone: full.phone,
      avatar: full.avatar ?? null,
      deptId: full.deptId,
      deptName: full.dept?.name ?? null,
      role: full.role && roleCodes.includes(full.role.code)
        ? { id: full.role.id, name: full.role.name, code: full.role.code }
        : null,
      roles: roleCodes,
      menus,
    };
  }

  async getUserMenus(roleIds: number[]): Promise<any[]> {
    const ids = [...new Set(roleIds.filter((x) => x != null))];
    if (!ids.length) return [];

    const roles = await this.roleRepo.find({
      where: { id: In(ids), status: 1 },
      relations: { menus: true },
    });
    if (!roles.length) return [];

    // 系统管理员始终可见启用菜单；其他角色按显式授权取并集。
    const assignedIds = new Set<number>();
    const allMenus = await this.menuRepo.find({ where: { status: 1 } });
    // 回收站对已登录用户开放，具体单据始终按原模块数据范围裁决。
    for (const menu of allMenus) if (menu.type === 'menu' && menu.path === '/system/recycle-bin') assignedIds.add(menu.id);
    if (roles.some(role => role.code === 'admin')) {
      for (const menu of allMenus) if (menu.type === 'menu') assignedIds.add(menu.id);
    }
    for (const role of roles) {
      for (const m of role.menus ?? []) {
        if (m.status === 1 && m.type === 'menu') assignedIds.add(m.id);
      }
    }
    if (!assignedIds.size) return [];

    // 全量启用菜单，内存建父子索引（补父用）
    const byId = new Map<number, Menu>();
    for (const m of allMenus) byId.set(m.id, m);

    // 收集被分配节点 + 全部祖先（父自动补齐；guard 防环）
    const visibleIds = new Set<number>();
    const collectAncestors = (id: number) => {
      let cur = byId.get(id);
      let guard = 0;
      while (cur && !visibleIds.has(cur.id) && guard < 20) {
        visibleIds.add(cur.id);
        cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
        guard += 1;
      }
    };
    for (const id of assignedIds) collectAncestors(id);

    const visible = allMenus
      .filter((m) => visibleIds.has(m.id) && m.type === 'menu')
      .sort((a, b) => a.sort - b.sort);

    return this.buildMenuTree(visible, null);
  }

  private buildMenuTree(menus: Menu[], parentId: number | null): any[] {
    return menus
      .filter((m) => m.parentId === parentId)
      .sort((a, b) => a.sort - b.sort)
      .map((m) => ({
        id: m.id,
        name: m.name,
        path: m.path,
        icon: m.icon,
        children: this.buildMenuTree(menus, m.id),
      }))
      .filter((m) => m.children?.length > 0 || m.path); // 有路径或有子菜单
  }

  // ---- 私有方法 ----

  private async resolveUserPermission(user: User): Promise<{
    roles: string[];
    roleIds: number[];
    dataScopes: UserScopeEntry[];
  }> {
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

    return { roles: codes, roleIds: roleRows.map((r) => r.roleId as number), dataScopes };
  }

  async getUserAccessCodes(user: any): Promise<string[]> {
    const userId = getUserId(user);
    if (userId == null) return [];
    // 后台服务有时只传目标用户 ID（例如新增方案确认人资格校验）。这类调用没有 JWT 中的
    // tokenVersion，若固定缓存为 `${userId}:`，角色授权后会永久命中旧结果。先读取账号当前
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

  private async generateToken(user: User) {
    const { roles, roleIds, dataScopes } = await this.resolveUserPermission(user);
    const payload = {
      sub: user.id,
      username: user.username,
      roleCode: roles[0] || 'user',
      roles,
      roleIds,
      deptId: user.deptId,
      dataScopes,
      tokenVersion: user.tokenVersion,
    };

    return {
      token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
      role: user.role && roles.includes(user.role.code)
          ? { id: user.role.id, name: user.role.name, code: user.role.code }
          : null,
        roles,
      },
    };
  }

  async updateMyProfile(user: JwtPayload, dto: Record<string, unknown>) {
    const uid = user?.sub;
    if (uid == null) throw new UnauthorizedException('登录状态异常，请重新登录');
    const ALLOWED = ['phone', 'email', 'avatar'];
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(dto)) {
      if (!ALLOWED.includes(key)) throw new BadRequestException(`字段 ${key} 不可自助修改`);
      const v = dto[key];
      patch[key] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException('没有可更新的字段');
    }
    if (patch.avatar != null && typeof patch.avatar === 'string') {
      const avatar = patch.avatar as string;
      const safeAvatar =
        avatar.startsWith('/uploads/') ||
        /^https:\/\//i.test(avatar);
      if (!safeAvatar) {
        throw new BadRequestException('头像仅支持相对上传路径（/uploads/）或 https 链接');
      }
    }
    await this.userRepo.update(uid, patch as any);
    return this.getProfile(user);
  }

  async changeMyPassword(user: JwtPayload, dto: ChangePasswordDto) {
    if (!user?.sub) throw new UnauthorizedException('请重新登录');
    if (dto.newPassword !== dto.confirmPassword) throw new BadRequestException('两次新密码不一致');
    if (dto.newPassword.length < 3 || Buffer.byteLength(dto.newPassword, 'utf8') > 72) {
      throw new BadRequestException('新密码至少 3 位，UTF-8 编码后最多 72 字节');
    }
    const current = await this.userRepo.findOne({
      where: { id: user.sub, status: 1 },
      select: { id: true, password: true, tokenVersion: true, status: true },
    });
    if (!current?.password) throw new UnauthorizedException('账号不可用，请重新登录');
    if (current.tokenVersion !== user.tokenVersion) throw new UnauthorizedException('登录状态已变化，请重新登录');
    if (!(await bcrypt.compare(dto.oldPassword, current.password))) throw new BadRequestException('原密码不正确');
    if (await bcrypt.compare(dto.newPassword, current.password)) throw new BadRequestException('新密码不能与原密码相同');
    const password = await bcrypt.hash(dto.newPassword, 10);
    // 条件更新同时防止并发改密和管理员重置覆盖；会话版本与密码一起原子更新。
    const result = await this.userRepo.createQueryBuilder().update(User).set({
      password, tokenVersion: () => 'token_version + 1',
    }).where({ id: current.id, password: current.password, tokenVersion: current.tokenVersion, status: 1 }).execute();
    if (result.affected !== 1) throw new ConflictException('账号信息已变化，请重新登录后再试');
    return { message: '密码已修改，请重新登录' };
  }
}
