import type { EntityManager } from 'typeorm';
import { evaluateOperationSwitch, otherRecordPermission, type ScopeOperation, type ScopeUser } from '../../common/utils/data-scope';
import { getUserId } from '../../common/utils/service-helpers';
import { attachmentDownloadPermission, findAttachmentScopeSubject } from '../attachment/attachment-access';
import { Attachment } from '../attachment/attachment.entity';
import { AttachmentRecycle } from '../attachment/attachment-recycle.entity';
import { findAttachmentTarget } from '../attachment/attachment-targets.registry';
import { attachmentRecycleQuery } from '../example/attachment-recycle.service';
import { ExampleItem } from '../example/example-item.entity';
import { ExampleItemMember } from '../example/example-member.entity';
import { ExampleRecycle } from '../example/example-recycle.entity';
import { exampleRecycleQuery } from '../example/example-recycle.service';
import { RECYCLE_PERMISSIONS } from '../example/recycle-permissions';
import { EXPLAIN_REASONS as reasons, type ExplainAction, type ExplainReason, type RecordActionEvaluation } from '../user/permission-explanation.contracts';

interface FileAction {
  action: ExplainAction;
  codes: string[];
  operation?: ScopeOperation;
  documentOnly?: boolean;
}

export const fileLibraryActions: FileAction[] = [
  { action: 'list', codes: ['attachments:view'] },
  { action: 'download', codes: ['attachments:view', 'attachments:download'], operation: 'view' },
  { action: 'delete', codes: ['attachments:delete'], operation: 'delete' },
];

const recycleActions: FileAction[] = [
  { action: 'recycleDetail', codes: [], operation: 'view' },
  { action: 'restore', codes: [RECYCLE_PERMISSIONS.restore], operation: 'edit' },
  { action: 'purge', codes: [RECYCLE_PERMISSIONS.purge], operation: 'delete' },
];

function activeActions(row: Attachment | null): FileAction[] {
  if (!row || row.origin !== 'business' || row.status !== 'bound') return fileLibraryActions;
  const target = findAttachmentTarget(row.entityType);
  const readCode = attachmentDownloadPermission(row);
  const centerCodes = readCode ? ['attachments:view', readCode] : ['attachments:view'];
  return [
    { action: 'list', codes: centerCodes },
    { action: 'download', codes: centerCodes, operation: 'view' },
    { action: 'documentDownload', codes: target ? [target.viewPermission] : [], operation: 'view', documentOnly: true },
    { action: 'delete', codes: target ? [target.editPermission] : [], operation: 'edit', documentOnly: true },
  ];
}

function verdict(action: ExplainAction, result: RecordActionEvaluation['result'], readableReason: string, reason?: ExplainReason): RecordActionEvaluation {
  return { action, result, readableReason, reasonCodes: reason ? [reason] : [] };
}

async function explainDocumentRecycleDownload(
  manager: EntityManager, row: Attachment, user: ScopeUser, accountReason?: ExplainReason,
): Promise<RecordActionEvaluation> {
  const action = 'recycleDownload';
  if (accountReason) {
    return verdict(action, 'denied', accountReason === reasons.ACCOUNT_DISABLED ? '目标账号已禁用' : '目标账号需要先修改密码', accountReason);
  }
  const batch = row.entityType === 'example-items' && row.entityId != null
    ? await manager.getRepository(ExampleRecycle).findOneBy({ itemId: row.entityId })
    : null;
  if (!batch?.attachmentIds.includes(row.id)) {
    return verdict(action, 'unsupported', '该文件没有可查询的回收站删除批次', reasons.UNSUPPORTED_ACTION);
  }
  const inRange = await exampleRecycleQuery(manager, user).andWhere('e.id = :id', { id: row.entityId }).getOne();
  if (!inRange) return verdict(action, 'denied', '所属单据不在回收站的共同数据范围内', reasons.RECORD_NOT_FOUND);
  // 运行时（exampleRecycleQuery/locked）对团队成员按参与者口径放行，解释用同一判定避免与运行时背离
  const recycleUid = getUserId(user);
  const isParticipant = recycleUid != null && await manager.getRepository(ExampleItemMember).count({ where: { itemId: row.entityId!, userId: recycleUid } }) > 0;
  const gate = evaluateOperationSwitch(inRange, user, 'example-items', 'view', undefined, isParticipant);
  if (!gate.allowed) return verdict(action, 'denied', '所属单据的查看开关未开启，或记录没有归属人', reasons.RECYCLE_SWITCH_OFF);
  return verdict(action, 'allowed',
    isParticipant ? '该用户为此单据团队成员：可在单据回收站下载，恢复和彻底删除随单据操作'
      : '可在单据回收站下载，文件的恢复和彻底删除随单据操作',
    isParticipant ? reasons.RECORD_PARTICIPANT : undefined);
}

export async function explainAttachment(
  manager: EntityManager, id: number, user: ScopeUser, admin: boolean, codes: Set<string>,
  accountReason?: ExplainReason,
) {
  const repo = manager.getRepository(Attachment);
  const row = await repo.findOne({ where: { id }, withDeleted: true });
  const batch = row?.deletedAt ? await manager.getRepository(AttachmentRecycle).findOneBy({ attachmentId: id }) : null;
  if (row?.deletedAt && !batch) {
    return {
      row,
      actions: [{ action: 'recycleDownload', codes: [] }] satisfies FileAction[],
      evaluations: [await explainDocumentRecycleDownload(manager, row, user, accountReason)],
    };
  }
  const actions = row?.deletedAt ? recycleActions : activeActions(row);
  const target = findAttachmentTarget(row?.entityType);
  const activeBound = row?.origin === 'business' && row.status === 'bound';
  const scopedAttachment = row && (row.origin === 'center' || activeBound);
  const subject = !accountReason && row && !row.deletedAt && scopedAttachment
    ? await findAttachmentScopeSubject(repo, row, user)
    : null;
  const inRecycleScope = batch && !accountReason
    ? await attachmentRecycleQuery(manager, user).andWhere('a.id = :id', { id }).getOne()
    : null;
  // documentOnly 动作（经所属单据的下载/删除）运行时按单据参与者口径放行，解释同步判定
  const docUid = getUserId(user);
  const documentParticipant = !admin && docUid != null && !row?.deletedAt && row?.entityType === 'example-items' && row.entityId != null
    ? await manager.getRepository(ExampleItemMember).count({ where: { itemId: row.entityId, userId: docUid } }) > 0
    : false;
  const evaluations: RecordActionEvaluation[] = [];

  for (const { action, codes: required, operation, documentOnly } of actions) {
    const deny = (reason: ExplainReason, text: string) => verdict(action, 'denied', text, reason);
    const allow = (text: string) => verdict(action, 'allowed', text, admin ? reasons.ADMIN_EXCEPTION : undefined);
    if (accountReason) {
      evaluations.push(deny(accountReason, accountReason === reasons.ACCOUNT_DISABLED ? '目标账号已禁用' : '目标账号需要先修改密码'));
      continue;
    }
    const missing = admin ? [] : required.filter(code => !codes.has(code));
    if (missing.length) {
      evaluations.push(deny(reasons.OPERATION_PERMISSION_MISSING, '缺少操作权限 ' + missing.join('、')));
      continue;
    }
    if (!row) {
      evaluations.push(deny(reasons.RECORD_NOT_FOUND, '文件不存在'));
      continue;
    }
    if (row.deletedAt) {
      if (!batch || !inRecycleScope) {
        evaluations.push(deny(reasons.RECORD_NOT_FOUND, '文件不在回收站的共同数据范围内'));
      } else if (!await attachmentRecycleQuery(manager, user, operation).andWhere('a.id = :id', { id }).getOne()) {
        const otherCode = action === 'restore' ? RECYCLE_PERMISSIONS.restoreOthers
          : action === 'purge' ? RECYCLE_PERMISSIONS.purgeOthers : undefined;
        const limitedByRole = otherCode && !codes.has(otherCode)
          && await attachmentRecycleQuery(manager, { ...user, accessCodes: [...codes, otherCode] }, operation).andWhere('a.id = :id', { id }).getOne();
        evaluations.push(limitedByRole
          ? deny(reasons.OPERATION_PERMISSION_MISSING, '缺少操作他人记录的权限 ' + otherCode)
          : deny(reasons.RECYCLE_SWITCH_OFF, '存量配置仍限制该操作，或记录没有归属人'));
      } else if (action === 'restore' && batch.state !== 'deleted') {
        evaluations.push(deny(reasons.RECORD_STATE_BLOCKED, '文件已进入彻底删除流程，只能重试彻底删除'));
      } else if (action === 'restore' && row.status === 'bound'
        && (row.entityType !== 'example-items' || !row.entityId || !await manager.getRepository(ExampleItem).existsBy({ id: row.entityId }))) {
        evaluations.push(deny(reasons.RECORD_STATE_BLOCKED, '所属单据不可用，恢复文件前需先恢复所属单据'));
      } else {
        evaluations.push(allow('回收站按当前数据范围及对应操作开关裁决'));
      }
      continue;
    }
    if (documentOnly && documentParticipant) {
      // 参与者直通：不经本人/他人开关；权限码校验已在上方完成，与文档侧运行时（findOneForWrite 参与者裁决）同口径
      evaluations.push(verdict(action, 'allowed', '该用户为此单据团队成员：按角色权限码经所属单据裁决', reasons.RECORD_PARTICIPANT));
      continue;
    }
    if (activeBound && !target && (!admin || documentOnly)) {
      evaluations.push(deny(reasons.RECORD_STATE_BLOCKED, '未登记的附件来源仅系统管理员可通过附件中心查看和下载'));
      continue;
    }
    if (scopedAttachment && (!admin || documentOnly) && !subject) {
      evaluations.push(deny(reasons.RECORD_NOT_FOUND, '文件或所属单据不存在，或不在共同数据范围内'));
      continue;
    }
    if (!admin && !scopedAttachment && row.createdBy !== getUserId(user)) {
      evaluations.push(deny(reasons.RECORD_NOT_FOUND, '未挂接的暂存附件仅上传者可管理'));
      continue;
    }
    const operations: ScopeOperation[] = operation === 'edit' ? ['edit', 'view'] : operation ? [operation] : [];
    let blocked: RecordActionEvaluation | undefined;
    if (subject && !admin) {
      for (const op of operations) {
        const gate = evaluateOperationSwitch(subject, user, subject.scopeKey, op);
        if (gate.allowed) continue;
        if (gate.reason === 'others_permission_missing') {
          blocked = deny(reasons.OPERATION_PERMISSION_MISSING, '缺少操作他人记录的权限 ' + otherRecordPermission(subject.scopeKey, op));
          break;
        }
        const reason = gate.reason === 'no_owner' ? reasons.NO_OWNER_RECORD
          : gate.reason === 'self_switch_off' ? reasons.SELF_SWITCH_OFF : reasons.OTHERS_SWITCH_OFF;
        const label = op === 'view' ? '查看' : op === 'edit' ? '编辑' : '删除';
        blocked = deny(reason, gate.reason === 'no_owner' ? '记录无归属人' : label + (gate.reason === 'self_switch_off' ? '本人' : '他人') + '记录的开关已关闭');
        break;
      }
    }
    evaluations.push(blocked ?? allow(documentOnly ? '按所属单据的权限裁决' : '满足附件操作权限和数据范围'));
  }
  return { row, actions, evaluations };
}
