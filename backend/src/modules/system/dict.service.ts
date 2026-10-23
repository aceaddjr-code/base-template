import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysDictType } from './entities/sys-dict-type.entity';
import { SysDictItem } from './entities/sys-dict-item.entity';
import { getUserId } from '../../common/utils/service-helpers';
import { SystemLogService } from './system-log.service';

@Injectable()
export class DictService {
  constructor(
    @InjectRepository(SysDictType) private readonly typeRepo: Repository<SysDictType>,
    @InjectRepository(SysDictItem) private readonly itemRepo: Repository<SysDictItem>,
    private readonly logService: SystemLogService,
  ) {}

  async findByCode(code: string) {
    const type = await this.typeRepo.findOne({ where: { code, status: 1 } });
    if (!type) throw new NotFoundException(`字典类型「${code}」不存在或已停用`);
    const items = await this.itemRepo.find({
      where: { typeId: type.id, status: 1 },
      order: { sort: 'ASC', id: 'ASC' },
    });
    return {
      code: type.code,
      name: type.name,
      options: items.map(({ label, value, color }) => ({ label, value, color })),
    };
  }

  /** 历史值回显（F40）：含停用项的全量选项（登录用户可用，仅供展示与标签解析） */
  async getAllItemsByCode(code: string) {
    const type = await this.typeRepo.findOne({ where: { code, status: 1 } });
    if (!type) throw new NotFoundException(`字典类型「${code}」不存在或已停用`);
    const items = await this.itemRepo.find({ where: { typeId: type.id }, order: { sort: 'ASC', id: 'ASC' } });
    return {
      code: type.code,
      name: type.name,
      options: items.map(({ label, value, color, status }) => ({ label, value, color, status })),
    };
  }

  /** 保存校验（F40）：value 在该类型下的状态；未变停用值由调用方回读原记录后放行 */
  async getValueStatus(typeCode: string, value: string): Promise<'enabled' | 'disabled' | 'unknown'> {
    const type = await this.typeRepo.findOne({ where: { code: typeCode, status: 1 } });
    if (!type) return 'unknown';
    const item = await this.itemRepo.findOne({ where: { typeId: type.id, value } });
    if (!item) return 'unknown';
    return item.status === 1 ? 'enabled' : 'disabled';
  }

  async findTypes(page = 1, pageSize = 20, keyword?: string) {
    const qb = this.typeRepo.createQueryBuilder('t')
      .where('t.deletedAt IS NULL')
      .orderBy('t.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (keyword) qb.andWhere('(t.code LIKE :kw OR t.name LIKE :kw)', { kw: `%${keyword}%` });
    const [list, total] = await qb.getManyAndCount();
    const ids = list.map(({ id }) => id);
    const counts = ids.length
      ? await this.itemRepo.createQueryBuilder('i')
          .select('i.typeId', 'typeId')
          .addSelect('COUNT(*)', 'count')
          .where('i.typeId IN (:...ids)', { ids })
          .groupBy('i.typeId')
          .getRawMany()
      : [];
    const countMap = new Map(counts.map((row: any) => [Number(row.typeId), Number(row.count)]));
    return { list: list.map((item) => ({ ...item, itemCount: countMap.get(item.id) ?? 0 })), total, page, pageSize };
  }

  async findItemsByTypeId(typeId: number) {
    if (!(await this.typeRepo.findOne({ where: { id: typeId } }))) {
      throw new NotFoundException('字典类型不存在');
    }
    return this.itemRepo.find({ where: { typeId }, order: { sort: 'ASC', id: 'ASC' } });
  }

  async createType(dto: any, user?: any) {
    const code = dto.code?.trim().toLowerCase();
    const name = dto.name?.trim();
    if (!code || !name) throw new BadRequestException('类型编码和名称不能为空');
    if (await this.typeRepo.findOne({ where: { code } })) {
      const message = `类型编码「${code}」已存在`;
      throw new BadRequestException({ message, fieldErrors: [{ path: 'code', code: 'unique', message }] });
    }
    const record = await this.typeRepo.save({ code, name, status: dto.status ?? 1, remark: dto.remark || null, createdBy: getUserId(user) });
    await this.writeLog('create', 'sys_dict_types', record.id, record.code, dto, user);
    return record;
  }

  async updateType(id: number, dto: any, user?: any) {
    const old = await this.typeRepo.findOne({ where: { id } });
    if (!old) throw new NotFoundException('字典类型不存在');
    if (dto.code && dto.code !== old.code && await this.typeRepo.findOne({ where: { code: dto.code } })) {
      const message = `类型编码「${dto.code}」已存在`;
      throw new BadRequestException({ message, fieldErrors: [{ path: 'code', code: 'unique', message }] });
    }
    await this.typeRepo.update(id, this.cleanUpdate(dto, user));
    await this.writeLog('update', 'sys_dict_types', id, old.code, dto, user, old);
    return this.typeRepo.findOne({ where: { id } });
  }

  async deleteType(id: number, user?: any) {
    const record = await this.typeRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('字典类型不存在');
    const count = await this.itemRepo.count({ where: { typeId: id } });
    if (count) throw new BadRequestException(`该类型下还有 ${count} 个选项，请先删除选项`);
    await this.typeRepo.softDelete(id);
    await this.writeLog('delete', 'sys_dict_types', id, record.code, undefined, user, record);
    return { message: '删除成功' };
  }

  async createItem(typeId: number, dto: any, user?: any) {
    const type = await this.typeRepo.findOne({ where: { id: typeId } });
    if (!type) throw new NotFoundException('字典类型不存在');
    const label = dto.label?.trim();
    const value = dto.value?.trim();
    if (!label || !value) throw new BadRequestException('选项显示值和存储值不能为空');
    if (await this.itemRepo.findOne({ where: { typeId, value } })) {
      const message = `选项值「${value}」已存在`;
      throw new BadRequestException({ message, fieldErrors: [{ path: 'value', code: 'unique', message }] });
    }
    const record = await this.itemRepo.save({
      typeId, label, value, color: dto.color || null, sort: dto.sort ?? 0,
      status: dto.status ?? 1, remark: dto.remark || null, createdBy: getUserId(user),
    });
    await this.writeLog('create', 'sys_dict_items', record.id, `${type.code}:${value}`, dto, user);
    return record;
  }

  async updateItem(id: number, dto: any, user?: any) {
    const old = await this.itemRepo.findOne({ where: { id } });
    if (!old) throw new NotFoundException('字典选项不存在');
    if (dto.value && dto.value !== old.value && await this.itemRepo.findOne({ where: { typeId: old.typeId, value: dto.value } })) {
      const message = `选项值「${dto.value}」已存在`;
      throw new BadRequestException({ message, fieldErrors: [{ path: 'value', code: 'unique', message }] });
    }
    await this.itemRepo.update(id, this.cleanUpdate(dto, user));
    await this.writeLog('update', 'sys_dict_items', id, old.value, dto, user, old);
    return this.itemRepo.findOne({ where: { id } });
  }

  async deleteItem(id: number, user?: any) {
    const record = await this.itemRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('字典选项不存在');
    await this.itemRepo.softDelete(id);
    await this.writeLog('delete', 'sys_dict_items', id, record.value, undefined, user, record);
    return { message: '删除成功' };
  }

  private cleanUpdate(dto: any, user?: any) {
    return Object.fromEntries([
      ...Object.entries(dto).filter(([, value]) => value !== undefined),
      ['updatedBy', getUserId(user)],
    ]);
  }

  private async writeLog(action: string, entityType: string, entityId: number, entityDesc: string, detail: any, user?: any, old?: unknown) {
    await this.logService.write({
      userId: getUserId(user), username: user?.username, action,
      entityType, entityId, entityDesc,
      detail: detail || old ? JSON.stringify({ ...(old ? { old } : {}), ...(detail ? { new: detail } : {}) }) : undefined,
    });
  }
}
