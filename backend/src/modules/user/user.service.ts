import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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

  /** 创建本地账号，用户和多角色关联在同一事务内保存。 */
  async create(dto: CreateUserDto, caller: JwtPayload) {
    const existing = await this.userRepo.findOne({ where: { username: dto.loginid }, withDeleted: true });
    if (existing) throw new BadRequestException({ message: '账号已存在', fieldErrors: [{ path: 'loginid', code: 'unique', message: '账号已存在，请更换登录账号' }] });
    await this.validateReferences(dto);
    const user = await this.userRepo.manager.transaction(async manager => {
      const saved = await manager.save(User, {
        username: dto.loginid,
        password: await bcrypt.hash(dto.password, 10),
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
    return this.findById(user.id);
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
    if (dto.password) updateData.password = await bcrypt.hash(dto.password, 10);
    await this.userRepo.manager.transaction(async manager => {
      if (Object.keys(updateData).length) await manager.update(User, id, updateData);
      if (roleChanged || roleIdsChanged || deptChanged || dto.password || (dto.status !== undefined && dto.status !== user.status)) {
        await manager.increment(User, { id }, 'tokenVersion', 1);
      }
      if (dto.roleIds !== undefined || roleChanged) {
        await this.syncUserRoles(id, dto.roleId !== undefined ? dto.roleId : user.roleId,
          dto.roleIds ?? currentExtra, manager);
      }
    });
    return this.findById(id);
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
