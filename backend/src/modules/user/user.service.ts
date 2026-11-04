import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './user.entity';
import { UserRole } from './user-role.entity';
import { Role } from '../role/role.entity';
import { Department } from '../department/department.entity';
import * as bcrypt from 'bcryptjs';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { generateTemporaryPassword, TEMPORARY_PASSWORD_TTL_HOURS } from '../auth/account-security.contracts';
import { SystemLogService } from '../system/system-log.service';
import { deptSubtreeSelect } from '../../common/utils/dept-subtree';

@Injectable()
export class UserService {

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
    @InjectRepository(Department)
    private deptRepo: Repository<Department>,
    @InjectRepository(UserRole)
    private userRoleRepo: Repository<UserRole>,
    private readonly logService: SystemLogService,
  ) {}

  private async syncUserRoles(
    userId: number,
    mainRoleId: number | null,
    extraRoleIds: number[] = [],
    em?: any,
  ) {
    const ids = [...new Set([mainRoleId, ...extraRoleIds].filter((x) => x != null))] as number[];
    const run = async (manager: any) => {
      await manager.delete(UserRole, { userId });
      if (ids.length) {
        await manager.save(
          UserRole,
          ids.map((roleId) => ({ userId, roleId, ownerId: userId, createdBy: userId })),
        );
      }
    };
    if (em) {
      await run(em);
    } else {
      await this.userRoleRepo.manager.transaction(run);
    }
  }

  private async assertLeaderValid(leaderId: number | null) {
    if (leaderId == null) return;
    const leader = await this.userRepo.findOne({ where: { id: leaderId } });
    if (!leader) {
      throw new BadRequestException('直属上级不存在，请选择启用用户');
    }
    if (leader.status !== 1) {
      throw new BadRequestException('直属上级已被禁用，请选择启用用户');
    }
  }

  private async assertNoCycle(userId: number, leaderId: number | null) {
    if (leaderId == null) return;
    const seen = new Set<number>([userId]);
    let cur: number | null = leaderId;
    while (cur != null) {
      if (seen.has(cur)) {
        throw new BadRequestException('不能形成循环汇报（直属上级链上已包含该用户）');
      }
      seen.add(cur);
      const l = await this.userRepo.findOne({
        where: { id: cur },
        select: { id: true, leaderId: true, status: true },
      });
      if (!l) break;
      cur = (l as any).leaderId ?? null;
    }
  }

  async findAll(
    page = 1,
    pageSize = 10,
    keyword?: string,
    deptIdParam?: number,
    status?: number[],
    created?: { from?: string; before?: string },
  ) {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.dept', 'dept')
      .orderBy('user.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    // 筛选字段白名单：keyword(账号/姓名 LIKE)、deptId(含子部门)、status(0/1)、createdAt(日期区间，结束日次日零点排他)
    if (keyword) {
      qb.andWhere('user.username LIKE :kw OR user.displayName LIKE :kw', {
        kw: `%${keyword}%`,
      });
    }

    if (deptIdParam != null) {
      const ids = await this.collectDeptWithChildren(deptIdParam);
      qb.andWhere('user.deptId IN (:...scopeDeptIds)', { scopeDeptIds: ids.length ? ids : [-1] });
    }

    if (status?.length) {
      qb.andWhere('user.status IN (:...statuses)', { statuses: status });
    }

    if (created?.from) {
      qb.andWhere('user.created_at >= :createdFrom', { createdFrom: created.from });
    }
    if (created?.before) {
      qb.andWhere('user.created_at < :createdBefore', { createdBefore: created.before });
    }

    const [list, total] = await qb.getManyAndCount();

    // 批量补齐附加角色，保证列表回显完整：编辑回显缺角色会被当成"已取消全部勾选"而误清空
    const ids = list.map((u) => u.id);
    if (ids.length) {
      const rows = await this.userRoleRepo.find({ where: { userId: In(ids) }, select: { userId: true, roleId: true } });
      const byUser = new Map<number, number[]>();
      for (const r of rows) {
        const arr = byUser.get(r.userId) ?? [];
        arr.push(r.roleId);
        byUser.set(r.userId, arr);
      }
      for (const u of list) {
        (u as any).roleIds = (byUser.get(u.id) ?? []).filter((rid) => rid !== u.roleId);
      }
    }

    return { list, total, page, pageSize };
  }

  /** 收集某部门及全部子孙部门 id（与数据范围过滤同一子树口径，含自身） */
  private async collectDeptWithChildren(deptId: number): Promise<number[]> {
    const rows = await this.deptRepo.query(deptSubtreeSelect('id = ?'), [deptId]);
    return rows.map((r: { id: number }) => Number(r.id));
  }

  async findAllSimple() {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.dept', 'dept')
      .where('u.status = 1 AND u.deleted_at IS NULL')
      .orderBy('u.username', 'ASC');
    const users = await qb.getMany();
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      deptId: u.deptId,
      deptName: u.dept?.name ?? null,
    }));
  }

  /** 根据 ID 查用户（caller 传入时校验部门归属） */
  async findById(id: number): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id },
      relations: { role: true, dept: true },
    });
    if (!user) throw new NotFoundException('用户不存在');
    (user as any).roleIds = (
      await this.userRoleRepo.find({ where: { userId: id }, select: { roleId: true } })
    )
      .map((r) => r.roleId)
      .filter((rid) => rid !== user.roleId);
    return user;
  }

  /** 创建本地账号：密码由服务端生成一次性临时密码（成功响应仅返回一次），用户和多角色关联在同一事务内保存。 */
  async create(dto: CreateUserDto, caller: JwtPayload) {
    if (dto.password !== undefined && dto.password !== '') {
      throw new BadRequestException('创建用户不再接受密码入参，临时密码由系统生成并在成功响应中一次性返回');
    }
    const existing = await this.userRepo.findOne({ where: { username: dto.loginid }, withDeleted: true });
    if (existing) throw new BadRequestException({ message: '账号已存在', fieldErrors: [{ path: 'loginid', code: 'unique', message: '账号已存在，请更换登录账号' }] });
    await this.validateReferences(dto);
    const temporaryPassword = generateTemporaryPassword();
    const temporaryPasswordExpiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_HOURS * 3600000);
    const user = await this.userRepo.manager.transaction(async manager => {
      const saved = await manager.save(User, {
        username: dto.loginid,
        password: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: 1,
        temporaryPasswordExpiresAt,
        displayName: dto.displayName,
        email: dto.email || null,
        phone: dto.phone || null,
        roleId: dto.roleId ?? null,
        deptId: dto.deptId ?? null,
        leaderId: dto.leaderId ?? null,
        status: 1,
        createdBy: caller.sub,
      });
      await this.syncUserRoles(saved.id, dto.roleId ?? null, dto.roleIds ?? [], manager);
      return saved;
    });
    const created = await this.findById(user.id);
    // 一次性凭据：仅本响应返回，列表/详情/日志不保存明文（响应头 no-store 由控制器设置）。
    return { ...created, temporaryPassword, expiresAt: temporaryPasswordExpiresAt.toISOString() };
  }

  private async validateReferences(dto: CreateUserDto | UpdateUserDto) {
    const roleIds = [...new Set([dto.roleId, ...(dto.roleIds ?? [])].filter((id): id is number => id != null))];
    for (const id of roleIds) {
      const role = await this.roleRepo.findOne({ where: { id, status: 1 } });
      if (!role) throw new BadRequestException('角色不存在或已停用');
    }
    if (dto.deptId != null && !(await this.deptRepo.findOne({ where: { id: dto.deptId, status: 1 } }))) {
      throw new BadRequestException('部门不存在或已停用');
    }
    if (dto.leaderId != null) await this.assertLeaderValid(dto.leaderId);
  }

  async update(
    id: number,
    dto: UpdateUserDto,
    caller: JwtPayload,
  ) {
    const user = await this.findById(id);

    // 只指向启用用户；不能指向自己；沿链防环（B→A 且 A→B 同理）
    if (dto.leaderId !== undefined) {
      const newLeader = dto.leaderId ?? null;
      if (newLeader === id) {
        throw new BadRequestException('不能设置自己为直属上级');
      }
      await this.assertLeaderValid(newLeader);
      await this.assertNoCycle(id, newLeader);
    }

    if (caller.sub === id && dto.status === 0) throw new ForbiddenException('不能禁用自己');
    await this.validateReferences(dto);

    // 角色/附加角色/部门任一变化时递增 tokenVersion：JWT 里 roles[]/deptId 是权限唯一依据，
    const roleChanged = dto.roleId !== undefined && (dto.roleId ?? null) !== (user.roleId ?? null);
    const currentExtra = [...((user as any).roleIds ?? [])].sort((a: number, b: number) => a - b);
    const mainId = dto.roleId !== undefined ? dto.roleId : user.roleId;
    const newExtra = [...new Set(dto.roleIds ?? [])]
      .filter((x: number) => x != null && x !== mainId)
      .sort((a, b) => a - b);
    const roleIdsChanged =
      dto.roleIds !== undefined && JSON.stringify(currentExtra) !== JSON.stringify(newExtra);
    const deptChanged = dto.deptId !== undefined && dto.deptId !== user.deptId;

    const updateData: any = {};
    for (const k of ['email', 'phone', 'roleId', 'deptId', 'status', 'displayName', 'leaderId'] as const) {
      if (dto[k] !== undefined) updateData[k] = dto[k];
    }
    // 普通编辑不再改密码：非空 password 一律拒绝并指向专用重置动作（规格 3.4）。
    if (dto.password !== undefined && dto.password !== '') {
      throw new BadRequestException('编辑用户不能修改密码，请使用「重置密码」生成临时密码');
    }
    await this.userRepo.manager.transaction(async manager => {
      if (Object.keys(updateData).length) await manager.update(User, id, updateData);
      if (roleChanged || roleIdsChanged || deptChanged || (dto.status !== undefined && dto.status !== user.status)) {
        await manager.increment(User, { id }, 'tokenVersion', 1);
      }
      if (dto.roleIds !== undefined || roleChanged) {
        await this.syncUserRoles(id, dto.roleId !== undefined ? dto.roleId : user.roleId,
          dto.roleIds ?? currentExtra, manager);
      }
    });
    return this.findById(id);
  }

  /**
   * 管理员重置密码（规格 3.2/3.4）：生成一次性临时密码、标记待改密并原子递增
   * tokenVersion——旧密码与旧会话立即失效。条件更新防本人改密并发竞争，
   * 审计与状态变更同事务提交，失败整体回滚。凭据仅本响应返回一次。
   */
  async resetPassword(id: number, caller: JwtPayload, meta?: { ip?: string | null; via?: string; allowSelf?: boolean }) {
    // 本机恢复命令（recovery-cli）显式允许对目标管理员本人执行，HTTP 入口不允许。
    if (caller.sub === id && !meta?.allowSelf) {
      throw new ForbiddenException('不能重置自己的密码；本人改密请在登录后自助修改');
    }
    const target = await this.userRepo.findOne({
      where: { id },
      select: { id: true, username: true, displayName: true, status: true, tokenVersion: true },
    });
    if (!target) throw new NotFoundException('用户不存在或已删除');
    if (target.status !== 1) throw new BadRequestException('目标账号已被禁用，请先启用再重置密码');
    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = new Date(Date.now() + TEMPORARY_PASSWORD_TTL_HOURS * 3600000);
    await this.userRepo.manager.transaction(async manager => {
      const result = await manager
        .createQueryBuilder()
        .update(User)
        .set({
          password: await bcrypt.hash(temporaryPassword, 10),
          mustChangePassword: 1,
          temporaryPasswordExpiresAt: expiresAt,
          tokenVersion: () => 'token_version + 1',
        })
        .where('id = :id AND token_version = :version AND status = 1', { id, version: target.tokenVersion })
        .execute();
      if (result.affected !== 1) throw new ConflictException('目标账号状态已变化，请刷新后重试');
      await this.logService.writeInTransaction(manager, {
        userId: caller.sub,
        username: caller.username,
        action: 'update',
        entityType: 'users',
        entityId: id,
        entityDesc: target.displayName || target.username,
        detail: JSON.stringify({ event: 'password_reset', target: target.username, expiresAt: expiresAt.toISOString(), via: meta?.via ?? 'admin' }),
        ip: meta?.ip ?? null,
      });
    });
    return { temporaryPassword, expiresAt: expiresAt.toISOString() };
  }

  /**
   * 撤销目标账号全部会话（规格 3.4）：仅原子递增 tokenVersion——提交后的新鉴权
   * 一律拒绝旧版本；不改变密码、待改密状态或启用状态，也不禁止重新登录。
   * 已通过鉴权的在途请求不被取消；重试撤销可再次递增，绝不降低版本。
   * 审计与版本递增同事务提交，失败整体回滚。
   */
  async revokeSessions(id: number, caller: JwtPayload, meta?: { ip?: string | null }) {
    if (caller.sub === id) {
      throw new ForbiddenException('不能对自己执行「退出全部登录」；本人请直接修改密码或退出登录');
    }
    const target = await this.userRepo.findOne({
      where: { id },
      select: { id: true, username: true, displayName: true, status: true, tokenVersion: true },
    });
    if (!target) throw new NotFoundException('用户不存在或已删除');
    if (target.status !== 1) throw new BadRequestException('目标账号已被禁用，旧会话已随禁用失效');
    await this.userRepo.manager.transaction(async manager => {
      await manager.increment(User, { id }, 'tokenVersion', 1);
      await this.logService.writeInTransaction(manager, {
        userId: caller.sub,
        username: caller.username,
        action: 'update',
        entityType: 'users',
        entityId: id,
        entityDesc: target.displayName || target.username,
        detail: JSON.stringify({ event: 'sessions_revoked', target: target.username, fromVersion: target.tokenVersion }),
        ip: meta?.ip ?? null,
      });
    });
    return { message: '已退出全部登录，该账号可重新登录' };
  }

  /** 启用/禁用 */
  async toggleStatus(id: number, caller: JwtPayload) {
    // 系统管理员可禁用自己 → 自己的 tokenVersion 立即递增 → 当场锁死
    if (caller.sub === id) {
      throw new ForbiddenException('不能禁用自己');
    }
    const user = await this.findById(id);
    const newStatus = user.status === 1 ? 0 : 1;
    // 递增 tokenVersion 使旧 Token 立即失效
    await this.userRepo.increment({ id }, 'tokenVersion', 1);
    await this.userRepo.update(id, { status: newStatus });
    return { status: newStatus };
  }

  /** 删除用户 */
  async delete(id: number, caller: JwtPayload) {
    if (caller.sub === id) {
      throw new ForbiddenException('不能删除自己');
    }
    const user = await this.findById(id);
    // 递增 tokenVersion 使旧 Token 立即失效
    await this.userRepo.increment({ id: user.id }, 'tokenVersion', 1);
    // 保留业务引用，同时清理角色授权；已删除用户不能登录。
    await this.userRepo.manager.transaction(async manager => {
      await manager.delete(UserRole, { userId:id });
      await manager.softDelete(User, id);
    });
    return { message: '删除成功' };
  }

}
