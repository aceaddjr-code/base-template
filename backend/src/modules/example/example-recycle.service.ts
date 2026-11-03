import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ExampleItem } from './example-item.entity';
import { ExampleRecycle, ExampleReservedNumber } from './example-recycle.entity';
import { ExampleChange, ExampleEvent } from './example-event.entity';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentService } from '../attachment/attachment.service';
import { buildDataScope, ScopeOperation } from '../../common/utils/data-scope';
import { UserDataScopeService } from '../user/user-data-scope.service';
import { JwtPayload } from '../auth/jwt.strategy';
import { SystemLog } from '../system/entities/system-log.entity';
import { AttachmentRecycle } from '../attachment/attachment-recycle.entity';

/** 当前唯一接入方为示例事项，业务恢复规则留在本模块。 */
@Injectable()
export class ExampleRecycleService {
  constructor(private readonly db: DataSource, private readonly files: AttachmentService, private readonly scopes: UserDataScopeService) {}

  private async currentUser(user: JwtPayload) {
    return { ...user, dataScopes: await this.scopes.loadForSession(user.sub) };
  }

  private query(manager: EntityManager, user: JwtPayload, operation: ScopeOperation) {
    const qb = manager.getRepository(ExampleItem).createQueryBuilder('e').withDeleted()
      .innerJoin(ExampleRecycle, 'r', 'r.itemId = e.id').where('e.deletedAt IS NOT NULL');
    return buildDataScope(qb, 'e', user, 'example-items', operation);
  }

  async list(user: JwtPayload, page: number, size: number, keyword = '', module = '') {
    user = await this.currentUser(user);
    if (module && module !== 'example-items') return { list: [], total: 0 };
    const qb = this.query(this.db.manager, user, 'view');
    if (keyword.trim()) qb.andWhere('(e.docNo LIKE :keyword OR e.title LIKE :keyword)', { keyword: `%${keyword.trim().slice(0, 100)}%` });
    const [items, total] = await qb.addSelect('r.deletedAt').orderBy('r.deletedAt', 'DESC').addOrderBy('e.id', 'DESC').skip((page - 1) * size).take(size).getManyAndCount();
    const batches = items.length ? await this.db.getRepository(ExampleRecycle).findBy({ itemId: In(items.map(e => e.id)) }) : [];
    return { list: items.map(e => { const r = batches.find(r => r.itemId === e.id)!; return { id: e.id, module: 'example-items', moduleName: '示例事项', docNo: e.docNo, title: e.title, ownerId: e.ownerId, deletedAt: r.deletedAt, deletedBy: r.actorName, state: r.state }; }), total };
  }

  private async locked(manager: EntityManager, id: number, user: JwtPayload, operation: ScopeOperation) {
    const item = await this.query(manager, user, operation).andWhere('e.id = :id', { id }).setLock('pessimistic_write').getOne();
    if (!item) throw new NotFoundException('单据不存在或不在当前操作范围内');
    const batch = await manager.getRepository(ExampleRecycle).findOneByOrFail({ itemId: id });
    return { item, batch };
  }

  async detail(id: number, user: JwtPayload) {
    user = await this.currentUser(user);
    return this.db.transaction(async manager => {
      const { item, batch } = await this.locked(manager, id, user, 'view');
      const attachments = batch.attachmentIds.length ? await manager.getRepository(Attachment).find({ withDeleted: true, where: { id: In(batch.attachmentIds), entityType: 'example-items', entityId: id } }) : [];
      const events = await manager.getRepository(ExampleEvent).find({ where: { itemId: id }, order: { id: 'DESC' } });
      const changes = events.length ? await manager.getRepository(ExampleChange).findBy({ eventId: In(events.map(e => e.id)) }) : [];
      return { record: item, state: batch.state, attachments: attachments.map(a => ({ id: a.id, name: a.originalName, size: a.size })), events: events.map(({ requestId, interactionId, ...e }) => ({ ...e, changes: changes.filter(c => c.eventId === e.id) })) };
    });
  }

  async file(id: number, fileId: number, user: JwtPayload) {
    user = await this.currentUser(user);
    return this.db.transaction(async manager => {
      const { batch } = await this.locked(manager, id, user, 'view');
      if (!batch.attachmentIds.includes(fileId)) throw new NotFoundException('附件不存在');
      const row = await manager.getRepository(Attachment).findOne({ withDeleted: true, where: { id: fileId, entityId: id, entityType: 'example-items' } });
      if (!row) throw new NotFoundException('附件不存在');
      return this.files.openDownload(row);
    });
  }

  async restore(id: number, user: JwtPayload) {
    user = await this.currentUser(user);
    await this.db.transaction(async manager => {
      const { item, batch } = await this.locked(manager, id, user, 'edit');
      if (batch.state !== 'deleted') throw new BadRequestException('单据已开始彻底删除，请重试彻底删除');
      const attachments = await this.attachments(manager, id, batch);
      attachments.forEach(a => this.files.assertFileExists(a));
      await manager.getRepository(ExampleItem).restore(id);
      await manager.getRepository(ExampleItem).increment({ id }, 'version', 1);
      if (attachments.length) {
        await manager.getRepository(Attachment).restore(attachments.map(a => a.id));
        await manager.getRepository(Attachment).update(attachments.map(a => a.id), { recycleHeld: 0 });
      }
      await manager.getRepository(ExampleRecycle).delete(id);
      await manager.getRepository(ExampleEvent).save({ itemId: id, action: 'restore', result: 'success', objectLabel: item.title, actorId: user.sub, actorName: user.username, source: 'web', version: item.version + 1 });
    });
  }

  private async attachments(manager: EntityManager, id: number, batch: ExampleRecycle) {
    const rows = batch.attachmentIds.length ? await manager.getRepository(Attachment).find({ withDeleted: true, where: { id: In(batch.attachmentIds), entityType: 'example-items', entityId: id } }) : [];
    if (rows.length !== batch.attachmentIds.length) throw new BadRequestException('单据附件记录不完整，无法恢复');
    return rows;
  }

  async purge(id: number, user: JwtPayload) {
    user = await this.currentUser(user);
    // 先持久标记不可恢复；磁盘失败后可重试，不会恢复出部分缺失的单据。
    await this.db.transaction(async manager => {
      await this.locked(manager, id, user, 'delete');
      const independent = await manager.getRepository(Attachment).createQueryBuilder('a').withDeleted().innerJoin(AttachmentRecycle, 'ar', 'ar.attachmentId = a.id').where('a.entityType = :type AND a.entityId = :id', { type: 'example-items', id }).getCount();
      if (independent) throw new BadRequestException('请先在文件回收站处理该单据已单独删除的附件');
      await manager.getRepository(ExampleRecycle).update(id, { state: 'purging' });
    });
    await this.db.transaction(async manager => {
      const { item, batch } = await this.locked(manager, id, user, 'delete');
      const independent = await manager.getRepository(Attachment).createQueryBuilder('a').withDeleted().innerJoin(AttachmentRecycle, 'ar', 'ar.attachmentId = a.id').where('a.entityType = :type AND a.entityId = :id', { type: 'example-items', id }).getCount();
      if (independent) throw new BadRequestException('请先在文件回收站处理该单据已单独删除的附件');
      const rows = await manager.getRepository(Attachment).find({ withDeleted: true, where: { entityType: 'example-items', entityId: id } });
      for (const row of rows) this.files.eraseFile(row);
      if (item.docNo) await manager.getRepository(ExampleReservedNumber).upsert({ docNo: item.docNo }, ['docNo']);
      const events = await manager.getRepository(ExampleEvent).findBy({ itemId: id });
      if (events.length) await manager.getRepository(ExampleChange).delete({ eventId: In(events.map(e => e.id)) });
      await manager.getRepository(ExampleEvent).delete({ itemId: id });
      if (rows.length) await manager.getRepository(Attachment).delete(rows.map(a => a.id));
      await manager.getRepository(ExampleItem).delete(id);
      await manager.getRepository(ExampleRecycle).delete(batch.itemId);
      await manager.getRepository(SystemLog).save({ userId: user.sub, username: user.username, action: 'purge', entityType: 'example-items', entityId: id, entityDesc: item.docNo, detail: JSON.stringify({ result: 'success' }) });
    });
  }

  async batch(ids: number[], action: 'restore' | 'purge', user: JwtPayload) {
    const results: Array<{ id: number; success: boolean; reason?: string }> = [];
    for (const id of [...new Set(ids)]) {
      try { await this[action](id, user); results.push({ id, success: true }); }
      catch (error) { results.push({ id, success: false, reason: error instanceof HttpException ? error.message : '处理失败，请稍后重试' }); }
    }
    return results;
  }
}
