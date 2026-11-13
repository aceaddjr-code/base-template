import { ForbiddenException } from '@nestjs/common';
import type { ScopeUser } from '../../common/utils/data-scope';
import { isSystemAdmin } from '../../common/utils/permission-check';

export const RECYCLE_PERMISSIONS = {
  restore: 'recycle-bin:restore',
  purge: 'recycle-bin:purge',
  restoreOthers: 'recycle-bin:restore-others',
  purgeOthers: 'recycle-bin:purge-others',
} as const;

export function assertRecyclePermission(user: ScopeUser, action: 'restore' | 'purge') {
  if (!isSystemAdmin(user) && !user.accessCodes?.includes(RECYCLE_PERMISSIONS[action])) {
    throw new ForbiddenException(action === 'restore' ? '缺少回收站恢复权限' : '缺少回收站彻底删除权限');
  }
}
