import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Department } from './department.entity';
import { User } from '../user/user.entity';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private deptRepo: Repository<Department>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async findAll(keyword?: string) {
    const qb = this.deptRepo
      .createQueryBuilder('d')
      .where('d.deletedAt IS NULL')
      .orderBy('d.sort', 'ASC')
      .addOrderBy('d.id', 'ASC');
    const all = await qb.getMany();
    const kw = keyword?.trim().toLowerCase();
    if (!kw) return this.buildTree(all, null);
    // 命中节点连同祖先链一起保留，避免子部门命中而祖先被裁掉后无法展示路径
    const byId = new Map(all.map((d) => [d.id, d]));
    const visible = new Set<number>();
    for (const d of all) {
      if (!d.name.toLowerCase().includes(kw) && !(d.code ?? '').toLowerCase().includes(kw)) continue;
      let cur: Department | undefined = d;
      while (cur && !visible.has(cur.id)) {
        visible.add(cur.id);
        cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
      }
    }
    return this.buildTree(all.filter((d) => visible.has(d.id)), null);
  }

  /** 平级列表 → 树（含父级过滤：父被关键词命中时子树仍完整展示） */
  private buildTree(depts: Department[], parentId: number | null): any[] {
    return depts
      .filter((d) => d.parentId === parentId)
      .map((d) => ({
        ...d,
        children: this.buildTree(depts, d.id),
      }));
  }

  /** 启用部门（下拉数据源，登录用户可用） */
  async findAllEnabled() {
    return this.deptRepo.find({
      where: { status: 1 },
      order: { sort: 'ASC', id: 'ASC' },
    });
  }

  async findById(id: number) {
    const dept = await this.deptRepo.findOne({ where: { id } });
    if (!dept) throw new NotFoundException('部门不存在');
    return dept;
  }

  async create(dto: { name: string; code: string; parentId?: number | null; status?: number; sort?: number }) {
    // 唯一索引不含 deletedAt，软删除行仍占用编码；必须连已删除行一起查，否则 save 撞索引变成 500
    const exists = await this.deptRepo.findOne({ where: { code: dto.code }, withDeleted: true });
    if (exists) {
      const message = exists.deletedAt ? '该编码已被已删除部门占用，请更换编码' : '部门编码已存在';
      throw new BadRequestException({ message, fieldErrors: [{ path: 'code', code: 'unique', message }] });
    }
    return this.deptRepo.save({
      name: dto.name,
      code: dto.code,
      parentId: dto.parentId ?? null,
      status: dto.status ?? 1,
      sort: dto.sort ?? 0,
    });
  }

  async update(id: number, dto: { name?: string; parentId?: number | null; status?: number; sort?: number }) {
    await this.findById(id);
    if (dto.parentId === id) {
      throw new BadRequestException('上级部门不能是自己');
    }
    if (dto.parentId != null) {
      const descendants = await this.collectDescendantIds(id);
      if (descendants.includes(dto.parentId)) {
        throw new BadRequestException('不能将子部门设为上级部门');
      }
    }
    // code 可经 API 静默修改，破坏角色前缀派生
    const patch: Record<string, any> = {};
    for (const k of ['name', 'parentId', 'status', 'sort'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length) {
      await this.deptRepo.update(id, patch);
    }
    return this.findById(id);
  }

  /** 收集某部门全部子孙 id（删除/防环校验用） */
  private async collectDescendantIds(id: number): Promise<number[]> {
    const all = await this.deptRepo.find({ where: { deletedAt: IsNull() } });
    const result: number[] = [];
    const walk = (pid: number) => {
      for (const d of all) {
        if (d.parentId === pid) {
          result.push(d.id);
          walk(d.id);
        }
      }
    };
    walk(id);
    return result;
  }

  async delete(id: number) {
    await this.findById(id);
    const childCount = await this.deptRepo.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException('该部门下存在子部门，请先删除或调整子部门');
    }
    const userCount = await this.userRepo.count({ where: { deptId: id } });
    if (userCount > 0) {
      throw new BadRequestException(`该部门下存在 ${userCount} 个用户，请先调整用户部门`);
    }
    await this.deptRepo.softDelete(id);
    return { message: '删除成功' };
  }
}
