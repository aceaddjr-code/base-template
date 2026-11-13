import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import { Role } from './role.entity';
import { Menu } from '../menu/menu.entity';
import { UserRole } from '../user/user-role.entity';
import { User } from '../user/user.entity';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private roleRepo: Repository<Role>,
  ) {}

  /** 全量角色列表（分页） */
  async findAll(page = 1, pageSize = 10) {
    const [list, total] = await this.roleRepo.findAndCount({
      relations: { menus: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** 全部角色（下拉用） */
  async findAllEnabled() {
    return this.roleRepo.find({
      where: { status: 1 },
      select: { id: true, name: true, code: true },
    });
  }

  /** 根据 ID 查 */
  async findById(id: number) {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: { menus: true },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return role;
  }

  async create(dto: { name:string; code:string; description?:string }) {
    if (await this.roleRepo.findOne({ where:{ code:dto.code }, withDeleted:true })) {
      const message = '角色编码已存在';
      throw new BadRequestException({ message, fieldErrors: [{ path: 'code', code: 'unique', message }] });
    }
    const saved = await this.roleRepo.save({ ...dto, status:1 });
    return this.findById(saved.id);
  }

  async update(id:number, dto:{ name?:string; description?:string }) {
    await this.findById(id);
    await this.roleRepo.update(id, dto);
    return this.findById(id);
  }

  /** 分配菜单权限 */
  async assignMenus(id: number, menuIds: number[]) {
    await this.roleRepo.manager.transaction(async manager => {
      const roles = manager.getRepository(Role);
      const role = await roles.findOne({ where: { id }, relations: { menus: true } });
      if (!role) throw new NotFoundException('角色不存在');
      role.menus = await manager.getRepository(Menu).findBy({ id: In(menuIds) });
      await roles.save(role);
      await this.bumpRoleUsersTokenVersion(id, manager);
    });

    return this.findById(id);
  }

  /** 角色权限或范围变化后，使主角色和附加角色用户重新登录并使用新的权限缓存键。 */
  private async bumpRoleUsersTokenVersion(roleId: number, manager: EntityManager): Promise<void> {
    const userRoleRepo = manager.getRepository(UserRole);
    const userRepo = manager.getRepository(User);
    const [mainUsers, extraLinks] = await Promise.all([
      userRepo.find({ where: { roleId }, select: { id: true } }),
      userRoleRepo.find({ where: { roleId }, select: { userId: true } }),
    ]);
    const userIds = [...new Set([...mainUsers.map((u) => u.id), ...extraLinks.map((ur) => ur.userId)])];
    if (!userIds.length) return;
    await userRepo.createQueryBuilder()
      .update()
      .set({ tokenVersion: () => 'token_version + 1' })
      .whereInIds(userIds)
      .execute();
  }

  /** 获取角色的菜单 ID 列表 */
  async getMenuIds(id: number) {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: { menus: true },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return role.menus.map((m) => m.id);
  }

  async delete(id: number) {
    await this.findById(id);
    const userRoleRepo = this.roleRepo.manager.getRepository(UserRole);
    const extraRef = await userRoleRepo.count({ where: { roleId: id } });
    if (extraRef > 0) {
      throw new BadRequestException(`该角色已分配给 ${extraRef} 个用户，请先解除分配再删除`);
    }
    const userRepo = this.roleRepo.manager.getRepository(User);
    const mainRef = await userRepo.count({ where: { roleId: id } });
    if (mainRef > 0) {
      throw new BadRequestException(`该角色是 ${mainRef} 个用户的主角色，请先重新分配再删除`);
    }
    // 清理角色关联（role_menus 无实体，直接 SQL；role_depts 有实体）
    await this.roleRepo.manager.query('DELETE FROM role_menus WHERE role_id = ?', [id]);
    await this.roleRepo.softDelete(id);
    return { message: '删除成功' };
  }
}
