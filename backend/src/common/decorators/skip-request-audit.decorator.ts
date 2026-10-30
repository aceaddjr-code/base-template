import { SetMetadata } from '@nestjs/common';

export const SKIP_REQUEST_AUDIT = 'skip_request_audit';
/** 已自行可靠记录动作的入口跳过 HTTP 方法推断；不影响认证、权限或业务事务。 */
export const SkipRequestAudit = () => SetMetadata(SKIP_REQUEST_AUDIT, true);
