import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentRecycle } from '../attachment/attachment-recycle.entity';
import { AttachmentService } from '../attachment/attachment.service';
import { ExampleItem } from './example-item.entity';
import { ExampleEvent } from './example-event.entity';
import { scopeWhereClause, type ScopeOperation, type ScopeUser } from '../../common/utils/data-scope';
import { getUserId } from '../../common/utils/service-helpers';
import { isSystemAdmin } from '../../common/utils/permission-check';
import { exampleMemberScopeVisibility } from './example-member-visibility';
import { UserDataScopeService } from '../user/user-data-scope.service';
import { JwtPayload } from '../auth/jwt.strategy';
import { SystemLog } from '../system/entities/system-log.entity';
import { assertRecyclePermission, RECYCLE_PERMISSIONS } from './recycle-permissions';

/** 回收站实际操作与权限解释使用同一条数据范围查询。 */
export function attachmentRecycleQuery(manager: EntityManager, user: ScopeUser, operation?: ScopeOperation) {
  const qb = manager.getRepository(Attachment).createQueryBuilder('a').withDeleted()
    .innerJoin(AttachmentRecycle, 'r', 'r.attachmentId = a.id')
    .leftJoin(ExampleItem, 'e', 'a.entityType = :type AND e.id = a.entityId', { type: 'example-items' })
    .where('a.deletedAt IS NOT NULL AND a.recycleHeld = 1');
  if (isSystemAdmin(user)) return qb;
  const othersPermission = operation === 'edit' ? RECYCLE_PERMISSIONS.restoreOthers
    : operation === 'delete' ? RECYCLE_PERMISSIONS.purgeOthers : undefined;
  const clauses = [
    scopeWhereClause('a', user, 'attachments', operation, othersPermission),
    // business bound 附件跟随单据范围：团队成员可见性与单据侧同口径（成员可见参与单据的随删附件）
    scopeWhereClause('e', user, 'example-items', operation, othersPermission, exampleMemberScopeVisibility('e', user)),
  ];
  const params: Record<string, unknown> = { uid: getUserId(user) };
  const parts = clauses.map((clause, index) => {
    let sql = clause.sql ?? '1 = 1';
    for (const [key, value] of Object.entries(clause.params)) {
      const next = `s${index}_${key}`;
      sql = sql.replace(new RegExp(`:(\\.\\.\\.)?${key}(?![\\w])`, 'g'), (_match, spread) => `:${spread || ''}${next}`);
      params[next] = value;
    }
    return sql;
  });
  return qb.andWhere(`(
    (a.origin = 'center' AND (${parts[0]}))
    OR (a.origin = 'business' AND a.status = 'temp' AND a.createdBy = :uid)
    OR (a.origin = 'business' AND a.status = 'bound' AND e.id IS NOT NULL AND (${parts[1]}))
  )`, params);
}

@Injectable()
export class AttachmentRecycleService {
  constructor(private readonly db: DataSource, private readonly files: AttachmentService, private readonly scopes: UserDataScopeService) {}
  private async current(user: JwtPayload) { return { ...user, dataScopes: await this.scopes.loadForSession(user.sub) }; }
  async list(user: JwtPayload, page: number, size: number, keyword = '') {
    user = await this.current(user);
    const qb = attachmentRecycleQuery(this.db.manager, user, 'view');
    if (keyword.trim()) qb.andWhere('(a.originalName LIKE :keyword OR a.entityTitle LIKE :keyword)', { keyword: `%${keyword.trim().slice(0, 100)}%` });
    const [rows, total] = await qb.addSelect('r.deletedAt').orderBy('r.deletedAt', 'DESC').addOrderBy('a.id', 'DESC').skip((page - 1) * size).take(size).getManyAndCount();
    const batches = rows.length ? await this.db.getRepository(AttachmentRecycle).findBy({ attachmentId: In(rows.map(row => row.id)) }) : [];
    return { list: rows.map(row => { const r = batches.find(b => b.attachmentId === row.id)!; return { id: row.id, title: row.originalName, docNo: row.entityTitle ?? '', moduleName: row.origin === 'center' ? '文件库' : row.status === 'temp' ? '未挂接附件' : '业务附件', deletedAt: r.deletedAt, deletedBy: r.actorName, state: r.state }; }), total };
  }
  private async locked(manager: EntityManager, user: JwtPayload, id: number, op: ScopeOperation) {
    const row = await attachmentRecycleQuery(manager, user, op).andWhere('a.id = :id', { id }).setLock('pessimistic_write').getOne();
    if (!row) throw new NotFoundException('文件不存在或不在当前操作范围内');
    const batch = await manager.getRepository(AttachmentRecycle).findOneByOrFail({ attachmentId: id });
    return { row, batch };
  }
  async detail(id: number, user: JwtPayload) {
    user = await this.current(user);
    return this.db.transaction(async manager => { const { row, batch } = await this.locked(manager, user, id, 'view'); return { record: { title: row.originalName, size: row.size, source: row.entityTitle || (row.origin === 'center' ? '文件库' : '未挂接附件'), deletedAt: batch.deletedAt, deletedBy: batch.actorName }, state: batch.state, attachments: [], events: [] }; });
  }
  async restore(id: number, user: JwtPayload) {
    assertRecyclePermission(user, 'restore');
    user = await this.current(user);
    await this.db.transaction(async manager => {
      const { row, batch } = await this.locked(manager, user, id, 'edit');
      if (batch.state !== 'deleted') throw new BadRequestException('文件已开始彻底删除，请重试彻底删除');
      if (row.status === 'bound') {
        if (row.entityType !== 'example-items') throw new BadRequestException('所属业务类型暂不支持恢复');
        const parent = await manager.getRepository(ExampleItem).findOne({ where: { id: row.entityId! }, lock: { mode: 'pessimistic_write' } });
        if (!parent) throw new BadRequestException('请先恢复所属单据');
        await manager.getRepository(ExampleEvent).save({ itemId: parent.id, action: 'attachment_restore', result: 'success', objectLabel: row.originalName.slice(0, 100), actorId: user.sub, actorName: user.username, source: 'web', version: parent.version });
      }
      this.files.assertFileExists(row);
      await manager.getRepository(Attachment).restore(id);
      await manager.getRepository(Attachment).update(id, { recycleHeld: 0 });
      await manager.getRepository(AttachmentRecycle).delete(id);
    });
  }
  async purge(id: number, user: JwtPayload) {
    assertRecyclePermission(user, 'purge');
    user = await this.current(user);
    await this.db.transaction(async manager => { await this.locked(manager, user, id, 'delete'); await manager.getRepository(AttachmentRecycle).update(id, { state: 'purging' }); });
    await this.db.transaction(async manager => {
      const { row } = await this.locked(manager, user, id, 'delete');
      this.files.eraseFile(row);
      await manager.getRepository(Attachment).delete(id);
      await manager.getRepository(AttachmentRecycle).delete(id);
      await manager.getRepository(SystemLog).save({ userId: user.sub, username: user.username, action: 'purge', entityType: 'attachments', entityId: id, entityDesc: row.originalName.slice(0, 200), detail: JSON.stringify({ result: 'success' }) });
    });
  }
  async batch(ids: number[], action: 'restore' | 'purge', user: JwtPayload) {
    assertRecyclePermission(user, action);
    const results: Array<{ id: number; success: boolean; reason?: string }> = [];
    for (const id of [...new Set(ids)]) {
      try { await this[action](id, user); results.push({ id, success: true }); }
      catch (error) { results.push({ id, success: false, reason: error instanceof HttpException ? error.message : '处理失败，请稍后重试' }); }
    }
    return results;
  }
}
