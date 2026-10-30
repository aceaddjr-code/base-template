import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { Repository, ObjectLiteral, SelectQueryBuilder, EntityManager } from 'typeorm';
import { generateDocNo } from '../utils/doc-no-generator';
import { getUserId, formatDate, withDocNoRetry } from '../utils/service-helpers';
import { buildDataScope, canEditOwner, assertCanOperateOn, ScopeUser } from '../utils/data-scope';
import { ColumnDef, dataToExcel, excelToData } from '../utils/excel-helper';
import { dateRangeBounds } from '../utils/date-range';

/**
 * 子表配置
 *
 * - record_id 关联：普通子表（如 xxx_defects.record_id → 主表 id）
 * - source_id 关联：通用表（如 attachments.source_id + source_type）
 * - 其他列名（如 inspection_id）：子表用自定义关联列（sourceKey 传实体属性名或列名均可，TypeORM 均能映射）
 */
export interface ChildSpec {
  repo: Repository<any>;
  sourceKey: string;
  /** source_id 关联时固定写入的来源标识 */
  sourceType?: string;
  /** 子表仅单列时（如参与人姓名数组），把字符串元素映射到该列 */
  valueField?: string;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  /** 精确筛选（如 status=合格），key 需为主表列名 */
  filters?: Record<string, string>;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';

  mine?: string;
  /** 选中记录（仍受相同筛选和数据范围限制） */
  ids?: number[];
  /** 导出列 key，按请求顺序映射到模块白名单 */
  cols?: string[];
}

export interface CrudOptions {
  /** 是否启用数据级隔离（owner_id 口径，默认 true；配置类如表单模板设 false） */
  dataScoped?: boolean;
  /** 单据号前缀（不传则主表无自动编号字段，如表单模板） */
  docNoPrefix?: string;
  /** 编号字段列名（默认 docNo，特殊实体可覆盖） */
  docNoField?: string;
  /** keyword 模糊搜索的列（主表列名，如 ['supplier','name']） */
  searchFields?: string[];
  /** 主表可排序/筛选的列白名单（防止任意排序注入） */
  sortableFields?: string[];
  /**
   * 可精确筛选的列白名单（防 SQL 注入：列名不参数化）
   * 默认放行通用筛选列；特殊模块可覆盖
   */
  filterableFields?: string[];

  inFilterable?: string[];

  likeFilterableFields?: string[];

  dateFilterableFields?: string[];

  numberFilterableFields?: string[];

  mineField?: string;
  /** Excel 导出列定义（缺省则该模块 /export 返回 400） */
  excelColumns?: ColumnDef[];
  /** Excel 导入列映射 { 实体字段: [表头候选名] }（缺省则该模块 /import 返回 400） */
  excelImportMap?: Record<string, string[]>;
  /** 实体中文名（导出文件名 + sheet 名） */
  entityName?: string;
  /**
   * 乐观锁（F06）：启用后，客户端提交数字 version 时按
   * UPDATE … WHERE id = ? AND version = ?（原子条件更新，版本 +1）写入；
   * 0 行命中返回 409。未提交 version 的调用方保持原最后写入胜出行为。
   */
  optimisticLock?: boolean;

}

// 白名单完全由模块 options 显式声明；未声明 = 空白名单（精确筛选不生效，keyword 搜索不受影响）。
// 配错字段名会在首次 list() 时抛错（validateFilterWhitelist），不再静默失效。

export const PROTECTED_FIELDS = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];
/** 更新时额外剥离的字段（docNo 由后端生成，创建时保留生成值、更新时不可改；version 只用于乐观锁条件，客户端不可直接写） */
export const PROTECTED_FIELDS_UPDATE = [...PROTECTED_FIELDS, 'docNo', 'version'];

/**
 * 409 冲突结构化原因：reason 经全局异常过滤器透传，前端按 reason 分派处理出口；
 * message 只做展示，调用方不得通过匹配文案判断冲突类型。
 */
export function conflictWithReason(reason: string, message: string): ConflictException {
  return new ConflictException({ message, reason });
}

/**
 * 通用 CRUD 服务基类
 *
 * 各业务模块共享同一套分页/搜索/主子表读写逻辑，
 * 各模块 service 继承后只需提供仓储与子表配置。
 */
@Injectable()
export abstract class CrudBaseService<Entity extends ObjectLiteral> {
  protected readonly logger = new Logger(this.constructor.name);

  protected dataScopeKey: string | null = null;

  constructor(
    protected readonly repo: Repository<Entity>,
    protected readonly children: Record<string, ChildSpec> = {},
    protected readonly options: CrudOptions = {},
  ) {}

  private filterWhitelistCache: string[] | null = null;
  protected getFilterableWhitelist(): string[] {
    if (this.filterWhitelistCache !== null) return this.filterWhitelistCache;
    // 同字段双声明时精确声明被静默失效，启动即抛错（与字段不存在校验同风格）
    const conflict = (this.options.likeFilterableFields ?? []).filter(
      (f) =>
        (this.options.filterableFields ?? []).includes(f) ||
        (this.options.inFilterable ?? []).includes(f),
    );
    if (conflict.length) {
      throw new Error(
        `[${this.constructor.name}] 筛选字段 ${conflict.join(', ')} 同时声明在 filterableFields/inFilterable 与 likeFilterableFields——LIKE 优先，精确声明将被静默失效`,
      );
    }
    const merged = [
      ...(this.options.filterableFields ?? []),
      ...(this.options.inFilterable ?? []),
      ...(this.options.likeFilterableFields ?? []),
    ];
    const unique = Array.from(new Set(merged));
    const meta = this.repo.metadata;
    if (meta && typeof meta.hasColumnWithPropertyPath === 'function') {
      // 日期/数值区间白名单同样拼 SQL，一并校验（但不并入精确筛选白名单）
      const all = [
        ...unique,
        ...(this.options.dateFilterableFields ?? []),
        ...(this.options.numberFilterableFields ?? []),
      ];
      const bad = all.filter((f) => !meta.hasColumnWithPropertyPath(f));
      if (bad.length) {
        throw new Error(
          `[${this.constructor.name}] 筛选白名单字段不存在于实体: ${bad.join(', ')}（filterableFields/inFilterable/likeFilterableFields/dateFilterableFields/numberFilterableFields 声明错误）`,
        );
      }
    }
    this.filterWhitelistCache = unique;
    return unique;
  }

  /** 分页列表（keyword 模糊搜索 + 精确筛选 + 数据隔离） */
  async list(query: ListQuery, user?: ScopeUser) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 10));
    const qb = this.buildListQueryBuilder(query, user);
    const [list, total] = await qb.skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 列表和导出共用筛选、排序、额外业务条件及数据范围，分页只由调用方决定。 */
  protected buildListQueryBuilder(query: ListQuery, user?: ScopeUser) {
    const qb = this.repo
      .createQueryBuilder('t')
      .where('t.deletedAt IS NULL');

    if (this.options.dataScoped !== false) {
      this.applyScope(qb, 't', user);
      if (this.repo.metadata?.hasColumnWithPropertyPath?.('owner')) {
        qb.leftJoinAndSelect('t.owner', 'owner');
      }
    }
    this.applyExtraListFilter?.(qb, 't', user);
    if (query.ids !== undefined) {
      if (!query.ids.length || query.ids.length > 500 || query.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new BadRequestException('请选择 1 至 500 条有效记录');
      }
      qb.andWhere('t.id IN (:...selectedIds)', { selectedIds: [...new Set(query.ids)] });
    }

    // 关键词模糊搜索（LIKE 通配符转义，防 %/_ 过度匹配）
    const searchFields = this.options.searchFields ?? [];
    if (query.keyword && searchFields.length) {
      const escaped = String(query.keyword).replace(/[\\%_]/g, (m) => `\\${m}`);
      const conds = searchFields.map((f) => `t.${f} LIKE :kw ESCAPE '\\\\'`);
      qb.andWhere(`(${conds.join(' OR ')})`, { kw: `%${escaped}%` });
    }

    const filterable = this.getFilterableWhitelist();
    const inFilterable = this.options.inFilterable ?? [];
    const likeFilterable = this.options.likeFilterableFields ?? [];
    if (query.filters) {
      for (const [key, value] of Object.entries(query.filters)) {
        if (value === undefined || value === '') continue;
        if ((this.options.dateFilterableFields ?? []).some(field => key === `${field}From` || key === `${field}To`)) continue;
        if (likeFilterable.includes(key)) {
          // 模糊筛选（列头漏斗自由文本列）：LIKE %v%（通配符转义，防 %/_ 过度匹配）
          const escaped = String(value).replace(/[\\%_]/g, (m) => `\\${m}`);
          qb.andWhere(`t.${key} LIKE :${key} ESCAPE '\\\\'`, { [key]: `%${escaped}%` });
          continue;
        }
        if (!filterable.includes(key)) {
          // 白名单外的筛选列：忽略 + warn（不 400，兼容前端发版滞后；配错时日志可查）
          this.logger.warn(`[filter] 列 "${key}" 不在 ${this.constructor.name} 筛选白名单，已忽略`);
          continue;
        }
        if (inFilterable.includes(key) && String(value).includes(',')) {
          const vals = String(value).split(',').map((s) => s.trim()).filter(Boolean);
          if (vals.length) qb.andWhere(`t.${key} IN (:...${key})`, { [key]: vals });
        } else {
          qb.andWhere(`t.${key} = :${key}`, { [key]: value });
        }
      }
    }

    const dateFilterable = this.options.dateFilterableFields ?? [];
    for (const field of dateFilterable) {
      const { from, before } = dateRangeBounds(query.filters?.[`${field}From`], query.filters?.[`${field}To`]);
      if (from) qb.andWhere(`t.${field} >= :${field}From`, { [`${field}From`]: from });
      if (before) qb.andWhere(`t.${field} < :${field}Before`, { [`${field}Before`]: before });
    }

    const numberFilterable = this.options.numberFilterableFields ?? [];
    for (const field of numberFilterable) {
      const min = query.filters?.[`${field}Min`];
      const max = query.filters?.[`${field}Max`];
      if (min !== undefined && min !== '') qb.andWhere(`t.${field} >= :${field}Min`, { [`${field}Min`]: Number(min) });
      if (max !== undefined && max !== '') qb.andWhere(`t.${field} <= :${field}Max`, { [`${field}Max`]: Number(max) });
    }

    const mineField = this.options.mineField;
    if (mineField && query.mine === '1') {
      const uid = getUserId(user);
      if (uid != null) qb.andWhere(`t.${mineField} = :mineUid`, { mineUid: uid });
    }

    // 排序（白名单校验）
    const sortableFields = this.options.sortableFields ?? ['createdAt'];
    const sortBy = sortableFields.includes(query.sortBy ?? '') ? query.sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(`t.${sortBy}`, sortOrder);

    return qb;
  }

  async distinctValues(field: string, user?: ScopeUser): Promise<string[]> {
    if (!this.getFilterableWhitelist().includes(field)) return [];
    const qb = this.repo.createQueryBuilder('t').where('t.deletedAt IS NULL');
    if (this.options.dataScoped !== false) {
      this.applyScope(qb, 't', user);
    }
    const rows = await qb
      .select(`t.${field}`, 'v')
      .andWhere(`t.${field} IS NOT NULL`)
      .andWhere(`t.${field} != ''`)
      .groupBy(`t.${field}`)
      .orderBy(`t.${field}`, 'ASC')
      .limit(500)
      .getRawMany();
    return rows.map((r) => String(r.v)).filter(Boolean);
  }

  /** 详情（自动携带全部子表；数据隔离：查不到视为不存在，不泄露存在性） */
  async findOne(id: number, user?: ScopeUser) {
    const entity = await this.findOneForOperation(id, user, 'view');
    return this.withChildren(entity);
  }

  protected applyScope(qb: SelectQueryBuilder<any>, alias: string, user?: ScopeUser): void {
    if (this.options.dataScoped === false) return;
    buildDataScope(qb, alias, user, this.dataScopeKey ?? undefined);
  }

  protected applyExtraListFilter?(qb: SelectQueryBuilder<any>, alias: string, user?: ScopeUser): void {
    /* 默认不追加任何条件 */
  }

  /** 范围读取后的动作裁决：编辑附加查看资格，删除保持独立资格。部门范围的操作开关依赖前置 SQL 过滤，因此与范围读取不拆开开放。 */
  private assertOperationAllowed(entity: Entity, user: ScopeUser | undefined, operation: 'view' | 'edit' | 'delete'): void {
    if (this.options.dataScoped !== false && this.repo.metadata?.hasColumnWithPropertyPath?.('ownerId')) {
      const scopeKey = this.dataScopeKey ?? '__global__';
      assertCanOperateOn(entity, user, scopeKey, operation);
      if (operation === 'edit') assertCanOperateOn(entity, user, scopeKey, 'view');
    }
  }

  /**
   * 先在当前数据范围内读取，再裁决当前操作；范围外统一视为不存在，不泄露存在性。
   */
  private async findOneForOperation(id: number, user: ScopeUser | undefined, operation: 'view' | 'edit' | 'delete'): Promise<Entity> {
    let entity: Entity | null;
    if (this.options.dataScoped === false) {
      entity = await this.repo.findOne({ where: { id } as any });
    } else {
      if (getUserId(user) == null) throw new UnauthorizedException('未登录');
      const qb = this.repo.createQueryBuilder('t').where('t.id = :id', { id });
      this.applyScope(qb, 't', user);
      entity = await qb.getOne();
    }
    if (!entity) throw new NotFoundException('记录不存在');
    this.assertOperationAllowed(entity, user, operation);
    return entity;
  }

  /**
   * 事务内的带锁授权读取（写路径 seam）：在当前数据范围内按主键加行锁读取，再裁决操作开关。
   * 供子类在事务内实现「读取旧值 → 版本/规则校验 → 写入」；行锁保证读到提交前的稳定旧值。
   */
  protected async findOneForWrite(manager: EntityManager, id: number, user: ScopeUser | undefined, operation: 'view' | 'edit' | 'delete'): Promise<Entity> {
    if (this.options.dataScoped !== false && getUserId(user) == null) throw new UnauthorizedException('未登录');
    const qb = manager.getRepository(this.repo.target).createQueryBuilder('t').where('t.id = :id', { id }).setLock('pessimistic_write');
    if (this.options.dataScoped !== false) this.applyScope(qb, 't', user);
    const entity = await qb.getOne();
    if (!entity) throw new NotFoundException('记录不存在');
    this.assertOperationAllowed(entity, user, operation);
    return entity;
  }

  /** 乐观锁冲突（F06）：版本已被推进或记录已删除/不在范围内，统一 reason 供前端分派。 */
  protected versionConflict(): ConflictException {
    return conflictWithReason('version_stale', '记录已被他人修改或已删除，请刷新后查看最新内容');
  }

  /**
   * 创建（自动生成单据号 + 保存子表）
   * 单据号唯一索引冲突（并发竞态）时自动重新生成重试（最多 8 次，随机错峰）
   */
  async create(dto: any, userId?: number, user?: ScopeUser) {
    if (this.options.dataScoped !== false && getUserId(user) == null) throw new UnauthorizedException('未登录');
    // 仅当配置了单据号自动生成时才按"单据号冲突"重试
    // （无 docNoPrefix 的实体的唯一键冲突重试无意义，直接抛错）
    if (!this.options.docNoPrefix) {
      try {
        return await this.createOnce(dto, userId, user);
      } catch (err) {
        // 唯一键冲突（非单据号）：返回友好提示
        const code = (err as any)?.driverError?.code ?? (err as any)?.code;
        if (code === 'ER_DUP_ENTRY') {
          throw new BadRequestException('数据已存在（唯一键冲突），请检查后重试');
        }
        throw err;
      }
    }
    return withDocNoRetry(() => this.createOnce(dto, userId, user), {
      maxAttempts: 8,
      onRetry: (attempt) => this.logger.warn(`单据号冲突，重新生成重试（第 ${attempt} 次）`),
    });
  }

  private async createOnce(dto: any, userId?: number, user?: ScopeUser) {
    // 事务只负责写入；提交后再用普通连接查询（事务内查询看不到未提交数据）
    const savedId = await this.repo.manager.transaction(async (manager) => {
      const docNoPrefix = this.options.docNoPrefix;
      if (docNoPrefix) {
        const field = this.options.docNoField ?? 'docNo';
        dto = { ...dto, [field]: await this.generateDocNo(docNoPrefix) };
      }
      // 剥离子表数据
      const { children, main } = this.extractChildren(dto);
      // 剥离客户端不可写的系统字段
      for (const field of PROTECTED_FIELDS) delete main[field];
      const uid = getUserId({ id: userId } as any) || null;
      const canSetOwner = canEditOwner(user);
      let ownerId = main.ownerId;
      if (!canSetOwner || ownerId == null) ownerId = uid;
      delete main.ownerId;
      const entity = this.repo.create({
        ...main,
        ownerId,
        createdBy: uid,
      } as any);
      const saved = await manager.save(entity as any);
      if (Object.keys(children).length) {
        await this.saveChildrenTx(manager, (saved as any).id, children);
      }
      return (saved as any).id;
    });
    return this.findOne(savedId, user);
  }

  /** 更新（主表字段合并 + 子表全量替换，事务保证原子性；数据隔离 + 负责人变更权限） */
  async update(id: number, dto: any, userId?: number, user?: ScopeUser) {
    const existing = await this.findOneForOperation(id, user, 'edit');

    // 负责人变更权限：只有 系统管理员能改负责人
    if (dto.ownerId !== undefined && dto.ownerId !== (existing as any).ownerId) {
      if (!canEditOwner(user)) {
        throw new ForbiddenException('只有系统管理员可以修改单据负责人');
      }
    }

    // F06 乐观锁：客户端提交的 version 仅作为条件，不进入写入列
    const expectedVersionRaw = Number(dto?.version);
    const expectedVersion = this.options.optimisticLock && Number.isInteger(expectedVersionRaw) && expectedVersionRaw > 0 ? expectedVersionRaw : null;

    await this.repo.manager.transaction(async (manager) => {
      const { children, main } = this.extractChildren(dto);
      // 剥离客户端不可写的系统字段（含 docNo/docNoField：更新不允许改单据号）
      const protectedFields = [...PROTECTED_FIELDS_UPDATE, this.options.docNoField ?? 'docNo'];
      for (const field of protectedFields) delete main[field];
      // 允许空串/0 等值写入，忽略 undefined
      const patch: Record<string, any> = {};
      for (const [key, value] of Object.entries(main)) {
        if (value !== undefined) patch[key] = value;
      }
      patch.updatedBy = getUserId({ id: userId } as any) || null;
      if (expectedVersion != null) {
        // 原子条件更新：版本已变或记录已删除时 0 行命中，整体回滚（含子表）
        const result = await manager.update(
          this.repo.metadata.target as any,
          { id, version: expectedVersion } as any,
          { ...patch, version: expectedVersion + 1 } as any,
        );
        if (!result.affected) throw this.versionConflict();
      } else {
        await manager.update(this.repo.metadata.target as any, id, patch as any);
      }

      if (Object.keys(children).length) {
        await this.replaceChildrenTx(manager, id, children);
      }
    });
    // 事务提交后查询
    return this.findOne(id, user);
  }

  async remove(id: number, user?: ScopeUser) {
    await this.findOneForOperation(id, user, 'delete');
    await this.repo.manager.transaction(async (manager) => {
      await manager.getRepository(this.repo.target).softDelete(id);
      for (const spec of Object.values(this.children)) {
        await this.softDeleteChildrenTx(manager, id, spec);
      }
    });
    return { success: true };
  }

  // ===== 子表读写 =====

  /** 从 DTO 中剥离子表数据（children 字段），其余为主表字段 */
  private extractChildren(dto: any): { children: Record<string, any[]>; main: Record<string, any> } {
    const children: Record<string, any[]> = {};
    const main: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto ?? {})) {
      if (Array.isArray(value) && this.children[key]) {
        children[key] = value;
      } else {
        main[key] = value;
      }
    }
    return { children, main };
  }

  /** 批量保存子表（回填主表 id；事务内用 manager 保证原子性） */
  private async saveChildrenTx(
    manager: any,
    parentId: number,
    children: Record<string, any[]>,
  ) {
    for (const [key, items] of Object.entries(children)) {
      if (!items?.length) continue;
      const spec = this.children[key];
      const rows = items.map((item) => {
        // 字符串/数字数组（如参与人姓名）→ valueField 映射
        if (spec.valueField && typeof item !== 'object') {
          return { [spec.valueField]: item, [spec.sourceKey]: parentId };
        }
        const { id: _id, deletedAt: _deletedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } =
          (item ?? {}) as Record<string, any>;
        const key = this.childKeyOf(spec);
        return { ...rest, [key]: parentId, ...(spec.sourceKey === 'source_id' ? { sourceType: spec.sourceType ?? null } : {}) };
      });
      await manager.save(spec.repo.target, manager.create(spec.repo.target, rows));
    }
  }

  private childKeyOf(spec: ChildSpec): string {
    if (spec.sourceKey === 'source_id') return 'sourceId';
    const meta = spec.repo.metadata as any;
    return (
      meta?.findColumnWithDatabaseName?.(spec.sourceKey)?.propertyName ??
      meta?.findColumnWithPropertyPath?.(spec.sourceKey)?.propertyName ??
      spec.sourceKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    );
  }

  /** 全量替换子表（先软删除旧的，再插入新的；事务内） */
  private async replaceChildrenTx(
    manager: any,
    parentId: number,
    children: Record<string, any[]>,
  ) {
    for (const [key, items] of Object.entries(children)) {
      const spec = this.children[key];
      await this.softDeleteChildrenTx(manager, parentId, spec);
      if (items?.length) {
        await this.saveChildrenTx(manager, parentId, { [key]: items });
      }
    }
  }

  /** 软删除某主表下的全部子表（事务内） */
  private async softDeleteChildrenTx(
    manager: any,
    parentId: number,
    spec: ChildSpec,
  ) {
    const where: Record<string, any> = { [this.childKeyOf(spec)]: parentId };
    if (spec.sourceKey === 'source_id' && spec.sourceType) {
      where.sourceType = spec.sourceType;
    }
    const rows = await manager.find(spec.repo.target, { where });
    if (rows.length) await manager.softRemove(spec.repo.target, rows);
  }

  /** 读取主表时携带全部子表 */
  protected async withChildren(entity: Entity): Promise<any> {
    const result = { ...entity } as any;
    for (const [key, spec] of Object.entries(this.children)) {
      const where: Record<string, any> = {
        [this.childKeyOf(spec)]: (entity as any).id,
      };
      if (spec.sourceKey === 'source_id' && spec.sourceType) {
        where.sourceType = spec.sourceType;
      }
      result[key] = await spec.repo.find({
        where,
        order: { id: 'ASC' } as any,
      });
    }
    return result;
  }

  // ===== Excel 导入导出 =====

  /** 导出不受列表每页 500 条限制；超过总量上限时明确拒绝，禁止静默截断。 */
  protected async getExportRows(user?: ScopeUser, query: ListQuery = {}): Promise<any[]> {
    const rows = await this.buildListQueryBuilder(query, user).take(50001).getMany();
    if (rows.length > 50000) throw new BadRequestException('导出最多 50000 条，请缩小筛选范围');
    return rows;
  }

  async exportExcel(user?: ScopeUser, query: ListQuery = {}): Promise<{ buffer: Buffer; filename: string }> {
    if (!this.options.excelColumns?.length) {
      throw new BadRequestException('该模块未配置导出列');
    }
    const available = new Map(this.options.excelColumns.map(column => [column.key, column]));
    const columns = query.cols === undefined ? this.options.excelColumns : [...new Set(query.cols)].flatMap(key => available.has(key) ? [available.get(key)!] : []);
    if (!columns.length) throw new BadRequestException('请至少选择一个可导出的数据列');
    const rows = await this.getExportRows(user, query);
    const buffer = await dataToExcel(rows, columns, this.options.entityName ?? '数据');
    const selectedTag = query.ids ? `选中${rows.length}条_` : '';
    return { buffer, filename: `${this.options.entityName ?? '导出数据'}_${selectedTag}${formatDate()}.xlsx` };
  }

  /**
   * 逐行导入：复用 create()（自动生成单据号、剥离系统字段、子表保存）。
   * 行级错误收集，返回 { imported, total, errors }；行号从第 2 行（Excel 表头后）起算。
   */
  async importFromExcel(buffer: Buffer, userId?: number, user?: ScopeUser) {
    if (!this.options.excelImportMap) {
      throw new BadRequestException('该模块未配置导入列映射');
    }
    const rows = await this.prepareImportRows(await excelToData(buffer, this.options.excelImportMap));
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // 剔除空值（避免覆盖数据库默认值），非空值原样交给 create
        const cleaned = Object.fromEntries(
          Object.entries(row).filter(([, v]) => v !== null && v !== ''),
        );
        await this.create(cleaned, userId, user);
        imported++;
      } catch (e) {
        errors.push({ row: i + 2, message: (e as Error).message });
      }
    }
    return { imported, total: rows.length, errors };
  }

  /**
   * 预检（F30）：与导入同套行准备与 create 规则，但绝不写数据——
   * 依赖数据库的校验（唯一键、外键等）由子类按需补充；确认导入时会重新验证。
   */
  async importPreview(buffer: Buffer, userId?: number, user?: ScopeUser) {
    if (!this.options.excelImportMap) {
      throw new BadRequestException('该模块未配置导入列映射');
    }
    const rows = await this.prepareImportRows(await excelToData(buffer, this.options.excelImportMap));
    const errors: Array<{ row: number; message: string }> = [];
    let valid = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        await this.validateImportRow(rows[i]);
        valid++;
      } catch (e) {
        errors.push({ row: i + 2, message: (e as Error).message });
      }
    }
    return { total: rows.length, valid, errors };
  }

  /** 批级行准备钩子（F30）：解析后、逐行校验/写入前调用一次；子类可做需要聚合上下文的整批准备（如字典标签→值翻译） */
  protected async prepareImportRows(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    return rows;
  }

  /** 行校验钩子：默认无（行准备在子类 prepareImportRow）;子类可扩展含数据库的异步校验 */
  protected async validateImportRow(row: Record<string, any>): Promise<void> {
    void row;
  }

  // ===== 单据号 =====

  protected async generateDocNo(prefix: string): Promise<string> {
    return generateDocNo(prefix, this.repo as any, this.options.docNoField ?? 'docNo');
  }
}
