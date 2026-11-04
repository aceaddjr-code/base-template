import { SetMetadata } from '@nestjs/common';

/** 待改密受限会话仍可访问的端点白名单标记（规格 3.3：profile/改密/登出）。 */
export const ALLOW_DURING_PASSWORD_CHANGE_KEY = 'allowDuringPasswordChange';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE_KEY, true);
