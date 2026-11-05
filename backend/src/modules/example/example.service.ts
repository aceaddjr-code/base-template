import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional, UnauthorizedException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { CrudBaseService, ListQuery, conflictWithReason } from '../../common/services/crud-base.service';
import { ExampleItem } from './example-item.entity';
import { ExampleRecycle, ExampleReservedNumber } from './example-recycle.entity';
import { AttachmentRecycle } from '../attachment/attachment-recycle.entity';
import { validateExample } from './example.dto';
import { DictService } from '../system/dict.service';
import { User } from '../user/user.entity';
import { ExampleEvent, ExampleChange } from './example-event.entity';
import { ExampleAccessDto, ExampleHistoryQuery } from './example-history.dto';
import { getUserId, withDocNoRetry } from '../../common/utils/service-helpers';
import { generateDocNo } from '../../common/utils/doc-no-generator';
import { dateRangeBounds } from '../../common/utils/date-range';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentService, ATTACHMENT_IMAGE_MIMES, ATTACHMENT_PREVIEW_IMAGE_EXTS } from '../attachment/attachment.service';
import { NotificationOutboxService, NOTIFICATION_OUTBOX } from '../system/notification-outbox.service';
import type { JwtPayload } from '../auth/jwt.strategy';

const CATEGORY_DICT = 'item_category';
/** 单据编号前缀：EX-yyyymmdd-001，创建时生成、全库唯一、不可修改。 */
const DOC_NO_PREFIX = 'EX';
import type { ScopeUser } from '../../common/utils/data-scope';
import { dataToExcel, excelToData, excelToDataWithMeta } from '../../common/utils/excel-helper';

const STATUS_LABELS = { pending: '待处理', doing: '进行中', done: '已完成' };
interface EventContext { interactionId?: string; requestId?: string; source?: 'web' | 'import'; batchId?: string; rowNumber?: number }

/** 本模块数据范围 scopeKey（唯一事实来源：scope-form.registry.ts 从这里引用，拼写漂移会导致编译错） */
export const EXAMPLE_ITEMS_SCOPE_KEY = 'example-items';

@Injectable()
export class ExampleService extends CrudBaseService<ExampleItem> {
  protected dataScopeKey = EXAMPLE_ITEMS_SCOPE_KEY;

  constructor(
    @InjectRepository(ExampleItem) repo: Repository<ExampleItem>,
    private readonly dictService?: DictService,
    @Optional() @InjectRepository(Attachment) attachmentRepo?: Repository<Attachment>,
    @Optional() private readonly attachmentService?: AttachmentService,
    @Optional() @Inject(NOTIFICATION_OUTBOX) private readonly outbox?: NotificationOutboxService,
  ) {
    super(repo, attachmentRepo ? { attachments: { repo: attachmentRepo, sourceKey: 'entityId', sourceType: 'example-items', typeKey: 'entityType' } } : {}, {
      entityName: '示例事项',
      optimisticLock: true,
      searchFields: ['docNo', 'title', 'description'],
      filterableFields: ['status'],
      inFilterable: ['status'],
      dateFilterableFields: ['createdAt', 'updatedAt'],
      sortableFields: ['createdAt', 'updatedAt', 'title', 'status', 'docNo'],
      mineField: 'ownerId',
      // 列顺序与前端字段注册表（frontend/src/views/examples/items/example-fields.ts）保持同键对齐：
      // 列设置勾选的字段经 cols 参数按 key 取列，键名漂移会被静默丢弃。
      excelColumns: [
        { header: '单据编号', key: 'docNo', width: 18 },
        { header: '标题', key: 'title', width: 24 },
        { header: '状态', key: 'status', width: 12 },
        { header: '类别', key: 'category', width: 18 },
        { header: '说明', key: 'description', width: 40 },
        { header: '单据负责人', key: 'ownerId', width: 14 },
        { header: '创建人', key: 'createdBy', width: 14 },
        { header: '创建时间', key: 'createdAt', width: 22 },
        { header: '更新时间', key: 'updatedAt', width: 22 },
        { header: '备注', key: 'remark', width: 30 },
      ],
      excelImportMap: {
        title: ['标题'],
        status: ['状态'],
        category: ['类别'],
        description: ['说明'],
        remark: ['备注'],
      },
    });
  }

  /** 附件列表独立读取，普通详情不下发文件路径等内部元数据。 */
  protected override async withChildren(entity: ExampleItem) { return { ...entity }; }

  async uploadAttachment(file: Express.Multer.File, user: JwtPayload) {
    return this.attachmentService!.saveFile(file, user, 'business');
  }

  async files(id: number, user?: ScopeUser) {
    return this.repo.manager.transaction(async manager => {
      await this.findOneForWrite(manager, id, user, 'view');
      const rows = await manager.getRepository(Attachment).find({ where: { entityType: 'example-items', entityId: id, status: 'bound' }, order: { id: 'DESC' } });
      return rows.map(row => ({ id: row.id, name: row.originalName, size: row.size, mimeType: row.mimeType, createdAt: row.createdAt, image: !!ATTACHMENT_IMAGE_MIMES[extname(row.originalName).toLowerCase()], previewable: ATTACHMENT_PREVIEW_IMAGE_EXTS.has(extname(row.originalName).toLowerCase()) }));
    });
  }

  async addFile(id: number, attachmentId: number, user?: ScopeUser) {
    return this.repo.manager.transaction(async manager => {
      const item = await this.findOneForWrite(manager, id, user, 'edit');
      const repo = manager.getRepository(Attachment);
      const row = await repo.findOne({ where: { id: attachmentId }, lock: { mode: 'pessimistic_write' } });
      if (!row || row.createdBy !== getUserId(user)) throw new NotFoundException('临时附件不存在');
      if (row.origin !== 'business') throw new BadRequestException('文件库文件不支持挂接到单据，请在单据中重新上传');
      if (row.status === 'bound' && row.entityType === 'example-items' && row.entityId === id) return { id: row.id };
      if (row.status !== 'temp' || row.entityId != null || row.entityType != null) throw new BadRequestException('附件已被使用');
      await repo.update(row.id, { entityId: id, entityType: this.children.attachments.sourceType, status: 'bound', entityTitle: item.title.slice(0, 255), updatedBy: getUserId(user) });
      const event = await this.appendEvent(manager, item, 'attachment_upload', user);
      await manager.getRepository(ExampleEvent).update(event.id, { objectLabel: row.originalName.slice(0, 100) });
      return { id: row.id };
    });
  }

  async file(id: number, fileId: number, user?: ScopeUser) {
    const row = await this.repo.manager.transaction(async manager => {
      await this.findOneForWrite(manager, id, user, 'view');
      const attachment = await manager.getRepository(Attachment).findOneBy({ id: fileId, entityType: 'example-items', entityId: id, status: 'bound' });
      if (!attachment) throw new NotFoundException('附件不存在');
      return attachment;
    });
    return { row, ...this.attachmentService!.openDownload(row) };
  }

  async removeFile(id: number, fileId: number, user?: ScopeUser) {
    return this.repo.manager.transaction(async manager => {
      const item = await this.findOneForWrite(manager, id, user, 'edit');
      const repo = manager.getRepository(Attachment);
      const row = await repo.findOneBy({ id: fileId, entityType: 'example-items', entityId: id, status: 'bound' });
      if (!row) throw new NotFoundException('附件不存在');
      await manager.getRepository(AttachmentRecycle).save({ attachmentId: row.id, deletedBy: getUserId(user)!, actorName: (user as JwtPayload)?.username || String(getUserId(user)), state: 'deleted' });
      await repo.update(row.id, { recycleHeld: 1 });
      await repo.softDelete(row.id);
      const event = await this.appendEvent(manager, item, 'attachment_delete', user);
      await manager.getRepository(ExampleEvent).update(event.id, { objectLabel: row.originalName.slice(0, 100) });
      return { success: true };
    });
  }

  /** 交互标识挪用（ID16）：同标识用于其他动作或对象时统一 409，reason 供前端分派。 */
  private intentConflict(): ConflictException {
    return conflictWithReason('intent_reused', '交互标识已用于其他操作，请重新发起');
  }

  private async appendEvent(manager: EntityManager, item: ExampleItem, action: string, user: ScopeUser | undefined, context: EventContext = {}) {
    const actorId = getUserId(user);
    if (actorId == null) throw new UnauthorizedException('未登录');
    const actor = await manager.getRepository(User).findOne({ where: { id: actorId }, select: { id: true, displayName: true, username: true } });
    if (!actor) throw new UnauthorizedException('用户不存在');
    return manager.getRepository(ExampleEvent).save({
      itemId: item.id, objectLabel: item.title, action, result: action === 'print' ? 'accepted' : action === 'no_change' ? 'no_change' : 'success',
      actorId, actorName: actor.displayName || actor.username, occurredAt: new Date(), source: context.source ?? 'web', requestId: context.requestId?.slice(0, 100) ?? null,
      interactionId: context.interactionId ?? null, batchId: context.batchId ?? null, rowNumber: context.rowNumber ?? null, version: item.version,
    });
  }

  async accessEvent(id: number, dto: ExampleAccessDto, user?: ScopeUser, requestId?: string) {
    try {
      return await this.repo.manager.transaction(async manager => {
        const item = await this.findOneForWrite(manager, id, user, 'view');
        if (dto.action === 'print' && dto.expectedVersion !== item.version) throw conflictWithReason('version_stale', '单据版本已变化，请重新加载后再打印');
        const events = manager.getRepository(ExampleEvent);
        const prior = await events.findOneBy({ actorId: getUserId(user)!, interactionId: dto.interactionId });
        if (prior && (prior.itemId !== id || prior.action !== dto.action || (dto.action === 'print' && prior.version !== dto.expectedVersion))) {
          throw this.intentConflict();
        }
        const event = prior ?? await this.appendEvent(manager, item, dto.action, user, { interactionId: dto.interactionId, requestId });
        return { record: item, eventId: event.id };
      });
    } catch (error) {
      // 跨单据并发复用同一标识由唯一索引裁决；同单据请求由行锁串行化。
      if (error?.code === 'ER_DUP_ENTRY' || error?.driverError?.code === 'ER_DUP_ENTRY') {
        // 唯一索引命中时首个请求已落库：同意图（同操作者/动作/单据/版本）复用该事件并重新鉴权返回，只有挪用才判冲突。
        return this.repo.manager.transaction(async manager => {
          const item = await this.findOneForWrite(manager, id, user, 'view');
          if (dto.action === 'print' && dto.expectedVersion !== item.version) throw conflictWithReason('version_stale', '单据版本已变化，请重新加载后再打印');
          const prior = await manager.getRepository(ExampleEvent).findOneBy({ actorId: getUserId(user)!, interactionId: dto.interactionId });
          if (!prior || prior.itemId !== id || prior.action !== dto.action || (dto.action === 'print' && prior.version !== dto.expectedVersion)) {
            throw this.intentConflict();
          }
          return { record: item, eventId: prior.id };
        });
      }
      throw error;
    }
  }

  async history(id: number, kind: 'activity' | 'operations' | 'changes', query: ExampleHistoryQuery, user?: ScopeUser) {
    return this.repo.manager.transaction(async manager => {
    await this.findOneForWrite(manager, id, user, 'view');
    const repo = manager.getRepository(ExampleEvent);
    const bounds = dateRangeBounds(query.from, query.to);
    let upper = query.upper;
    const fingerprint = JSON.stringify([id, kind, query.action ?? '', query.actorId ?? '', query.from ?? '', query.to ?? '', query.eventId ?? '', ...(query.actorName ? [query.actorName] : [])]);
    let cursor: { before: string; id: number; upper: number; fingerprint: string } | undefined;
    if (query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        if (!cursor || cursor.fingerprint !== fingerprint || !Number.isSafeInteger(cursor.id) || cursor.id < 1 || !Number.isSafeInteger(cursor.upper) || cursor.upper < 0 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(cursor.before)) throw new Error();
        dateRangeBounds(cursor.before.slice(0, 10));
        if (!/ (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}$/.test(cursor.before)) throw new Error();
        upper = cursor.upper;
      } catch { throw new BadRequestException('分页游标无效，请重新查询'); }
    }
    if (upper === undefined) {
      const latest = await repo.findOne({ where: { itemId: id }, order: { id: 'DESC' } });
      upper = latest?.id ?? 0;
    }
    const qb = repo.createQueryBuilder('e').where('e.itemId = :id AND e.id <= :upper', { id, upper });
    if (kind === 'activity') qb.andWhere('e.action IN (:...actions)', { actions: ['create', 'update', 'delete', 'restore'] });
    if (kind === 'changes') qb.andWhere('e.action = :updateAction', { updateAction: 'update' });
    if (query.action) qb.andWhere('e.action = :action', { action: query.action });
    if (query.actorId) qb.andWhere('e.actorId = :actorId', { actorId: query.actorId });
    if (query.actorName) qb.andWhere("e.actorName LIKE :actorName ESCAPE '!'", { actorName: `%${query.actorName.replace(/[!%_]/g, '!$&')}%` });
    // 日期筛选明确按北京时间解释，再由驱动按同一连接时区绑定 Date。
    if (bounds.from) qb.andWhere('e.occurredAt >= :from', { from: new Date(bounds.from.replace(' ', 'T') + '+08:00') });
    if (bounds.before) qb.andWhere('e.occurredAt < :before', { before: new Date(bounds.before.replace(' ', 'T') + '+08:00') });
    if (query.eventId) qb.andWhere('e.id = :eventId', { eventId: query.eventId });
    if (cursor) qb.andWhere('(e.occurredAt < :cursorTime OR (e.occurredAt = :cursorTime AND e.id < :cursorId))', { cursorTime: cursor.before, cursorId: cursor.id });
    qb.orderBy('e.occurredAt', 'DESC').addOrderBy('e.id', 'DESC');
    const size = query.pageSize ?? 20;
    const total = await qb.getCount();
    // raw 保留微秒用于精确游标；JS Date 仅有毫秒，不能作为数据库排序游标。
    const result = await qb.addSelect("DATE_FORMAT(e.occurredAt, '%Y-%m-%d %H:%i:%s.%f')", 'cursor_time')
      .skip(kind === 'activity' ? 0 : ((query.page ?? 1) - 1) * size).take(size + (kind === 'activity' ? 1 : 0)).getRawAndEntities();
    const hasMore = kind === 'activity' && result.entities.length > size;
    const events = result.entities.slice(0, size);
    // 动态与修改日志共用事件 diff：动态摘要展示字段变化（如负责人改派），明细仍在修改日志。
    const diffs = events.length && kind !== 'operations' ? await manager.getRepository(ExampleChange).find({ where: { eventId: In(events.map(e => e.id)) }, order: { id: 'ASC' } }) : [];
    const list = events.map(({ requestId: _request, interactionId: _interaction, ...event }) => ({ ...event, ...(kind !== 'operations' ? { changes: diffs.filter(d => d.eventId === event.id) } : {}) }));
    const last = events[events.length - 1];
    return { list, total, upper, page: query.page ?? 1, pageSize: size,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ before: result.raw[size - 1].cursor_time, id: last.id, upper, fingerprint })).toString('base64url') : null,
      notice: '本履历仅展示启用采集后的已记录事件；此前历史未记录。时间按北京时间显示。',
    };
    });
  }

  override async create(dto: unknown, userId?: number, user?: ScopeUser, context: EventContext = {}) {
    const validated = validateExample(dto);
    await this.assertCategorySelectable(validated.category ?? null);
    const actorId = getUserId(user);
    if (actorId == null) throw new UnauthorizedException('未登录');
    // 单据编号并发撞号时整个事务重跑（事件随事务回滚，不会重复记录）。
    return withDocNoRetry(() =>
      this.repo.manager.transaction(async manager => this.createWithinTx(manager, validated, actorId, user, context)),
    { onRetry: attempt => this.logger.warn(`单据编号冲突，重新生成重试（第 ${attempt} 次）`) },
    );
  }

  /** 事务体（第四批抽取）：普通 create 与导入确认共用；docNo 生成＋保存＋履历同事务。 */
  private async createWithinTx(manager: EntityManager, validated: ReturnType<typeof validateExample>, actorId: number, user: ScopeUser | undefined, context: EventContext) {
    const next = await generateDocNo(DOC_NO_PREFIX, manager.getRepository(ExampleItem), 'docNo');
    const reserved = await generateDocNo(DOC_NO_PREFIX, manager.getRepository(ExampleReservedNumber), 'docNo');
    const docNo = Number(next.split('-').at(-1)) >= Number(reserved.split('-').at(-1)) ? next : reserved;
    const item = await manager.getRepository(ExampleItem).save({ ...validated, category: validated.category || null, description: validated.description || null, remark: validated.remark || null, version: 1, docNo, ownerId: actorId, createdBy: actorId });
    await this.appendEvent(manager, item, 'create', user, context);
    return item;
  }

  /**
   * 导入会话行写入（第四批）：在调用方给定的同一事务内重新校验（字典可能停用/数据可能变化）
   * →创建单据→回填行成功状态由 ExampleImportService 完成。返回 {itemId, docNo}。
   */
  async importRowWithinTx(manager: EntityManager, row: { rowNumber: number; data: Record<string, any> }, user: ScopeUser, importId: string) {
    const actorId = getUserId(user);
    if (actorId == null) throw new UnauthorizedException('未登录');
    const validated = validateExample(row.data);
    await this.assertCategorySelectable(validated.category ?? null);
    const item = await this.createWithinTx(manager, validated, actorId, user, { source: 'import', batchId: importId, rowNumber: row.rowNumber });
    return { itemId: item.id, docNo: (item as any).docNo };
  }

  /** 导入标准列（第四批 03 修正文件用）：与导入映射同源，不另列清单。 */
  get importColumns() {
    return (this.options.excelImportMap ? Object.keys(this.options.excelImportMap) : []).map(key => {
      const column = this.options.excelColumns?.find((c) => c.key === key);
      return { header: column?.header ?? key, key, width: column?.width ?? 18 };
    });
  }

  /** 导入解析入口（第四批）：带原始坐标的受限解析；解析失败统一 400（畸形/多表/超限/表头无效）。 */
  async parseImportWithMeta(buffer: Buffer) {
    try {
      return await excelToDataWithMeta(buffer, this.options.excelImportMap!);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message || '文件无法解析');
    }
  }

  override async update(id: number, dto: unknown, userId?: number, user?: ScopeUser, context: EventContext = {}) {
    const validated = validateExample(dto, true);
    return this.repo.manager.transaction(async manager => {
      const old = await this.findOneForWrite(manager, id, user, 'edit');
      if (validated.version !== old.version) throw this.versionConflict();
      if (validated.category !== undefined && (validated.category || null) !== old.category) await this.assertCategorySelectable(validated.category || null);
      const tracked = { title: '标题', status: '状态', category: '类别', description: '说明', remark: '备注' };
      const next = { ...old };
      const changed: string[] = [];
      for (const key of Object.keys(tracked)) {
        if (validated[key] === undefined) continue;
        next[key] = validated[key] === '' ? null : validated[key];
        if ((old[key] ?? null) !== next[key]) changed.push(key);
      }
      if (!changed.length) {
        await this.appendEvent(manager, old, 'no_change', user, context);
        return old;
      }
      next.version = old.version + 1; next.updatedBy = getUserId(user)!;
      const item = await manager.getRepository(ExampleItem).save(next);
      const event = await this.appendEvent(manager, item, 'update', user, context);
      // 在同一事务采集当时名称；类型停用或软删除不妨碍清空存量类别。
      const labelBook = changed.includes('category') ? await this.dictService?.getLabelBook(CATEGORY_DICT, manager) : undefined;
      const label = (key: string, value: any) => value == null || value === '' ? null : key === 'status' ? STATUS_LABELS[value] ?? String(value) : key === 'category' ? labelBook?.display(value) ?? String(value) : null;
      await manager.getRepository(ExampleChange).save(changed.map(key => ({ eventId: event.id, fieldKey: key, fieldLabel: tracked[key], valueType: key === 'status' || key === 'category' ? 'enum' : 'text', beforeValue: old[key] ?? null, afterValue: item[key] ?? null, beforeLabel: label(key, old[key]), afterLabel: label(key, item[key]) })));
      return item;
    });
  }

  /**
   * 变更单据负责人（权限码 example-items:owner，与普通编辑解耦）。
   * 负责人即记录归属人：变更后数据范围的"本人/他人"口径随之转移。
   * 修改日志只存 ID 与当时姓名快照，不用当前姓名反推历史。
   */
  async changeOwner(id: number, ownerId: number, user?: ScopeUser, context: EventContext = {}) {
    return this.repo.manager.transaction(async manager => {
      const old = await this.findOneForWrite(manager, id, user, 'edit');
      if (old.ownerId === ownerId) {
        await this.appendEvent(manager, old, 'no_change', user, context);
        return old;
      }
      const rows = await manager.getRepository(User).find({ where: { id: In([old.ownerId, ownerId].filter((v): v is number => v != null)) }, select: { id: true, displayName: true, username: true } });
      if (!rows.some(row => row.id === ownerId)) throw new BadRequestException('单据负责人不存在或已删除，请重新选择');
      const nameOf = (uid: number | null) => {
        if (uid == null) return null;
        const row = rows.find(item => item.id === uid);
        return row ? row.displayName || row.username : `用户#${uid}`;
      };
      const item = await manager.getRepository(ExampleItem).save({ ...old, ownerId, updatedBy: getUserId(user)!, version: old.version + 1 });
      const event = await this.appendEvent(manager, item, 'update', user, context);
      await manager.getRepository(ExampleChange).save({
        eventId: event.id, fieldKey: 'ownerId', fieldLabel: '单据负责人', valueType: 'text',
        beforeValue: old.ownerId ?? null, afterValue: item.ownerId ?? null, beforeLabel: nameOf(old.ownerId), afterLabel: nameOf(ownerId),
      });
      // 第五批：真实变更且新负责人≠操作者 → 待投递意图与单据/履历同事务（业务键含事件 ID，再次指派不丢）
      if (ownerId !== getUserId(user) && this.outbox) {
        await this.outbox.enqueueWithinTx(manager, {
          eventId: String(event.id), recipientId: ownerId, type: 'owner-changed',
          bizType: 'example-items', bizId: item.id,
          title: '你收到一项负责人变更通知', content: '你有单据被指派为新的负责人，请在示例事项中查看。',
        });
      }
      return item;
    });
  }

  override async remove(id: number, user?: ScopeUser, context: EventContext = {}) {
    await this.repo.manager.transaction(async manager => {
      const item = await this.findOneForWrite(manager, id, user, 'delete');
      const attachments = this.children.attachments ? await manager.getRepository(Attachment).findBy({ entityType: 'example-items', entityId: id }) : [];
      await manager.getRepository(ExampleRecycle).save({ itemId: id, attachmentIds: attachments.map(a => a.id), deletedBy: getUserId(user)!, actorName: (user as JwtPayload)?.username || String(getUserId(user)), state: 'deleted' });
      if (attachments.length) await manager.getRepository(Attachment).update(attachments.map(a => a.id), { recycleHeld: 1 });
      await manager.getRepository(ExampleItem).softDelete(id);
      if (this.children.attachments) await this.softDeleteChildrenTx(manager, id, this.children.attachments);
      await this.appendEvent(manager, item, 'delete', user, context);
    });
    return { success: true };
  }

  override async importFromExcel(buffer: Buffer, userId?: number, user?: ScopeUser) {
    const rows = await this.prepareImportRows(await excelToData(buffer, this.options.excelImportMap!));
    const batchId = randomUUID(), errors: Array<{ row: number; message: string }> = [];
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        await this.create(rows[i], userId, user, { source: 'import', batchId, rowNumber: i + 2 });
        imported++;
      } catch (error) {
        const message = error instanceof HttpException && error.getStatus() < 500 ? error.message : '导入失败，请稍后重试';
        if (!(error instanceof HttpException) || error.getStatus() >= 500) this.logger.error(`导入批次 ${batchId} 第 ${i + 2} 行失败`, error instanceof Error ? error.stack : undefined);
        errors.push({ row: i + 2, message });
      }
    }
    return { imported, total: rows.length, errors, batchId };
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
  async batchRemove(ids: number[], user?: ScopeUser, requestId?: string) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException('请选择 1 至 500 条有效记录');
    }
    const unique = [...new Set(ids)];
    const batchId = randomUUID();
    const failures: Array<{ id: number; reason: string }> = [];
    let successCount = 0;
    for (const id of unique) {
      try { await this.remove(id, user, { batchId, requestId }); successCount++; }
      catch (error) {
        const reason = error instanceof HttpException && error.getStatus() < 500 ? error.message : '删除失败，请稍后重试';
        if (!(error instanceof HttpException) || error.getStatus() >= 500) this.logger.error(`批量删除记录 ${id} 失败`, error instanceof Error ? error.stack : undefined);
        failures.push({ id, reason });
      }
    }
    return { successCount, total: unique.length, failures, batchId };
  }

  protected override async getExportRows(user?: ScopeUser, query: ListQuery = {}) {
    const rows = await super.getExportRows(user, query);
    const labelBook = await this.dictService?.getLabelBook(CATEGORY_DICT);
    // 负责人/创建人投影为姓名展示（键与列表列设置勾选项对齐）；整批一次查询，已删除人员留空。
    const userIds = [...new Set(rows.flatMap(row => [row.ownerId, row.createdBy]).filter((id): id is number => id != null))];
    const users = userIds.length
      ? await this.repo.manager.getRepository(User).find({ where: { id: In(userIds) }, select: { id: true, displayName: true, username: true } })
      : [];
    const nameOf = (id: number | null | undefined) => {
      if (id == null) return '';
      const row = users.find(item => item.id === id);
      return row ? (row.displayName || row.username) : '';
    };
    return rows.map(row => ({
      ...row,
      status: STATUS_LABELS[row.status] ?? row.status,
      category: row.category ? (labelBook?.display(row.category) ?? row.category) : '',
      ownerId: nameOf(row.ownerId),
      createdBy: nameOf(row.createdBy),
      createdAt: row.createdAt ? new Date(row.createdAt) : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    }));
  }

  /** 模板下载：仅表头的单工作表（与导入列一致） */
  async importTemplateBuffer(): Promise<Buffer> {
    const headers = (this.options.excelImportMap ? Object.keys(this.options.excelImportMap) : []).map(key => {
      const column = this.options.excelColumns?.find((c) => c.key === key);
      return { header: column?.header ?? key, key, width: 18 };
    });
    return dataToExcel([], headers);
  }

  /** 导入会话服务回调入口（第四批）：与内部钩子同一实现。 */
  prepareImportRowsForSession(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    return this.prepareImportRows(rows);
  }

  /** 导入接受导出的展示值：状态与类别的字典标签整批翻译回内部值（F30/F40）；已是内部值原样通过 */
  protected override async prepareImportRows(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    const labelBook = await this.dictService?.getLabelBook(CATEGORY_DICT);
    return rows.map(row => {
      const cleaned = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== ''));
      const status = Object.entries(STATUS_LABELS).find(([, label]) => label === cleaned.status)?.[0];
      if (status) cleaned.status = status;
      if (typeof cleaned.category === 'string') {
        const value = labelBook?.valueOf(cleaned.category);
        if (value !== undefined) cleaned.category = value;
      }
      return cleaned;
    });
  }

  /** 预检与导入共用行校验（F30/F40）:DTO 规则 + 类别字典状态（含数据库查询）；确认导入会重新走同一套校验 */
  protected override async validateImportRow(row: Record<string, any>): Promise<void> {
    validateExample(row);
    await this.assertCategorySelectable(row.category ?? null);
  }

  /** 导入会话服务回调入口（第四批）：与内部钩子同一实现，不另写一套校验。 */
  validateImportRowPublic(row: Record<string, any>): Promise<void> {
    return this.validateImportRow(row);
  }
}
