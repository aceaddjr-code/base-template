import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudBaseService, ListQuery } from '../../common/services/crud-base.service';
import { ExampleItem } from './example-item.entity';
import { validateExample } from './example.dto';
import { DictService } from '../system/dict.service';

const CATEGORY_DICT = 'item_category';
import type { ScopeUser } from '../../common/utils/data-scope';
import { dataToExcel } from '../../common/utils/excel-helper';

const STATUS_LABELS = { pending: '待处理', doing: '进行中', done: '已完成' };

@Injectable()
export class ExampleService extends CrudBaseService<ExampleItem> {
  protected dataScopeKey = 'example-items';

  constructor(
    @InjectRepository(ExampleItem) repo: Repository<ExampleItem>,
    private readonly dictService?: DictService,
  ) {
    super(repo, {}, {
      entityName: '示例事项',
      optimisticLock: true,
      searchFields: ['title', 'description'],
      filterableFields: ['status'],
      inFilterable: ['status'],
      dateFilterableFields: ['createdAt', 'updatedAt'],
      sortableFields: ['createdAt', 'updatedAt', 'title', 'status'],
      mineField: 'ownerId',
      excelColumns: [
        { header: '标题', key: 'title', width: 24 },
        { header: '状态', key: 'status', width: 12 },
        { header: '类别', key: 'category', width: 18 },
        { header: '说明', key: 'description', width: 40 },
        { header: '更新时间', key: 'updatedAt', width: 22 },
      ],
      excelImportMap: {
        title: ['标题'],
        status: ['状态'],
        category: ['类别'],
        description: ['说明'],
      },
    });
  }

  override async create(dto: unknown, userId?: number, user?: ScopeUser) {
    const validated = validateExample(dto);
    await this.assertCategorySelectable(validated.category ?? null);
    return super.create(validated, userId, user);
  }

  override async update(id: number, dto: unknown, userId?: number, user?: ScopeUser) {
    const validated = validateExample(dto, true);
    // F40:回读原记录判断类别是否"未变"——未变的停用值允许保留,改选仅限启用项;不信任前端提交的原值
    if (validated.category !== undefined) {
      const old = await this.repo.findOne({ where: { id } });
      if (!old || (validated.category ?? null) !== (old.category ?? null)) {
        await this.assertCategorySelectable(validated.category ?? null);
      }
    }
    return super.update(id, validated, userId, user);
  }

  /** 类别为字典驱动字段:清空允许;新增/改选必须是启用中的选项,停用/不存在拒绝并落到字段 */
  private async assertCategorySelectable(category: string | null): Promise<void> {
    if (!category) return;
    if (!this.dictService) return;
    const status = await this.dictService.getValueStatus(CATEGORY_DICT, category);
    if (status === 'enabled') return;
    const message = status === 'disabled' ? '该类别已停用，请重新选择' : '类别不存在或已删除，请重新选择';
    throw new BadRequestException({ message, fieldErrors: [{ path: 'category', code: status === 'disabled' ? 'dict-disabled' : 'dict-unknown', message }] });
  }

  /** 仅编排现有单条删除；每条独立成功或失败，不另写数据范围和删除规则。 */
  async batchRemove(ids: number[], user?: ScopeUser) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException('请选择 1 至 500 条有效记录');
    }
    const unique = [...new Set(ids)];
    const failures: Array<{ id: number; reason: string }> = [];
    let successCount = 0;
    for (const id of unique) {
      try { await this.remove(id, user); successCount++; }
      catch (error) {
        const reason = error instanceof HttpException && error.getStatus() < 500 ? error.message : '删除失败，请稍后重试';
        if (!(error instanceof HttpException) || error.getStatus() >= 500) this.logger.error(`批量删除记录 ${id} 失败`, error instanceof Error ? error.stack : undefined);
        failures.push({ id, reason });
      }
    }
    return { successCount, total: unique.length, failures };
  }

  protected override async getExportRows(user?: ScopeUser, query: ListQuery = {}) {
    const rows = await super.getExportRows(user, query);
    const labels = await this.categoryDisplayLabels();
    return rows.map(row => ({
      ...row,
      status: STATUS_LABELS[row.status] ?? row.status,
      category: row.category ? (labels.get(row.category) ?? row.category) : '',
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    }));
  }

  /** 类别导出为字典名称；停用项加“（已停用）”后缀，与页面回显口径一致（F40） */
  private async categoryDisplayLabels(): Promise<Map<string, string>> {
    if (!this.dictService) return new Map();
    const { options } = await this.dictService.getAllItemsByCode(CATEGORY_DICT);
    return new Map(options.map(option => [option.value, option.status === 1 ? option.label : `${option.label}（已停用）`]));
  }

  /** 模板下载：仅表头的单工作表（与导入列一致） */
  async importTemplateBuffer(): Promise<Buffer> {
    const headers = (this.options.excelImportMap ? Object.keys(this.options.excelImportMap) : []).map(key => {
      const column = this.options.excelColumns?.find((c) => c.key === key);
      return { header: column?.header ?? key, key, width: 18 };
    });
    return dataToExcel([], headers);
  }

  /** 导入接受导出的展示值：状态与类别的字典标签整批翻译回内部值（F30/F40）；已是内部值原样通过 */
  protected override async prepareImportRows(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    const labels = await this.categoryImportMap();
    return rows.map(row => {
      const cleaned = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== ''));
      const status = Object.entries(STATUS_LABELS).find(([, label]) => label === cleaned.status)?.[0];
      if (status) cleaned.status = status;
      if (typeof cleaned.category === 'string' && labels.has(cleaned.category)) cleaned.category = labels.get(cleaned.category);
      return cleaned;
    });
  }

  /** 标签→值映射：停用项也翻译，让后续校验给出准确的“已停用”错误而不是“不存在” */
  private async categoryImportMap(): Promise<Map<string, string>> {
    if (!this.dictService) return new Map();
    const { options } = await this.dictService.getAllItemsByCode(CATEGORY_DICT);
    const map = new Map<string, string>();
    for (const option of options) {
      map.set(option.value, option.value);
      map.set(option.label, option.value);
      if (option.status !== 1) map.set(`${option.label}（已停用）`, option.value);
    }
    return map;
  }

  /** 预检与导入共用行校验（F30/F40）:DTO 规则 + 类别字典状态（含数据库查询）；确认导入会重新走同一套校验 */
  protected override async validateImportRow(row: Record<string, any>): Promise<void> {
    validateExample(row);
    await this.assertCategorySelectable(row.category ?? null);
  }
}
