import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Menu } from './menu.entity';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu)
    private menuRepo: Repository<Menu>,
  ) {}

  /** 菜单树 */
  async findTree() {
    const all = await this.menuRepo.find({
      where: { status: 1 },
      order: { sort: 'ASC' },
    });
    return this.buildTree(all, null);
  }

  /** 全部菜单（管理用，含禁用） */
  async findAll() {
    const all = await this.menuRepo.find({ order: { sort: 'ASC' } });
    return this.buildTree(all, null);
  }

  /** 根据 ID 查 */
  async findById(id: number) {
    const menu = await this.menuRepo.findOne({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    return menu;
  }

  /** 新增 */
  async create(dto: {
    parentId?: number;
    name: string;
    path?: string;
    icon?: string;
    type?: string;
    permission?: string;
    sort?: number;
  }) {
    return this.menuRepo.save(dto);
  }

  /** 编辑 */
  async update(
    id: number,
    dto: {
      name?: string;
      path?: string;
      icon?: string;
      type?: string;
      permission?: string | null;
      sort?: number;
      status?: number;
    },
  ) {
    await this.findById(id);
    const patch: Record<string, any> = {};
    for (const k of ['name', 'path', 'icon', 'type', 'permission', 'sort', 'status'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length) {
      await this.menuRepo.update(id, patch);
    }
    return this.findById(id);
  }

  /** 删除 */
  async delete(id: number) {
    await this.findById(id);
    // 检查是否有子菜单
    const children = await this.menuRepo.find({ where: { parentId: id } });
    if (children.length > 0) {
      throw new BadRequestException('请先删除子菜单');
    }
    await this.menuRepo.delete(id);
    return { message: '删除成功' };
  }

  private buildTree(
    menus: Menu[],
    parentId: number | null,
  ): (Menu & { children: Menu[]; hasChildren: boolean })[] {
    return menus
      .filter((m) => m.parentId === parentId)
      .map((m) => ({
        ...m,
        children: this.buildTree(menus, m.id),
      }))
      .map((m) => ({
        ...m,
        hasChildren: m.children.length > 0,
      }));
  }
}
