import type { Repository } from 'typeorm';
import { buildDataScope, scopeWhereClause, type ScopeUser } from '../../common/utils/data-scope';
import type { Attachment } from './attachment.entity';
import { findAttachmentTarget } from './attachment-targets.registry';

export const ATTACHMENTS_SCOPE_KEY = 'attachments';

export function attachmentDownloadPermission(row: Attachment): string | undefined {
  if (row.origin === 'business' && row.status === 'bound') {
    return findAttachmentTarget(row.entityType)?.viewPermission;
  }
  return 'attachments:download';
}

/** 读取范围内的真实归属。文件库以文件为准，已挂接附件以有效父单据为准。 */
export async function findAttachmentScopeSubject(
  repo: Repository<Attachment>, row: Attachment, user: ScopeUser,
): Promise<{ ownerId: number | null; scopeKey: string } | null> {
  if (row.origin === 'center') {
    const query = repo.createQueryBuilder('a').where('a.id = :id', { id: row.id });
    buildDataScope(query, 'a', user, ATTACHMENTS_SCOPE_KEY);
    const visible = await query.getOne();
    return visible ? { ownerId: visible.ownerId, scopeKey: ATTACHMENTS_SCOPE_KEY } : null;
  }
  const target = findAttachmentTarget(row.entityType);
  if (row.status !== 'bound' || !target) return null;
  const query = repo.manager.createQueryBuilder()
    .from(target.table, 'e')
    .select('e.owner_id', 'ownerId')
    .where('e.id = :id AND e.deleted_at IS NULL', { id: row.entityId });
  const clause = scopeWhereClause('e', user, target.scopeKey);
  if (clause.sql) query.andWhere(clause.sql.replace(/\be\.ownerId\b/g, 'e.owner_id'), clause.params);
  const document = await query.getRawOne<{ ownerId: number | null }>();
  return document ? { ownerId: document.ownerId, scopeKey: target.scopeKey } : null;
}
