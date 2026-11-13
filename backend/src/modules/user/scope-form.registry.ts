import { EXAMPLE_ITEMS_SCOPE_KEY } from '../example/example.service';
import { ATTACHMENTS_SCOPE_KEY } from '../attachment/attachment-access';

/** 使用数据范围的业务表单注册表。复制示例模块创建新业务时，在这里登记 scopeKey。 */
export const SCOPE_FORM_REGISTRY = [
  { scopeKey: EXAMPLE_ITEMS_SCOPE_KEY, label: '示例事项' },
  { scopeKey: ATTACHMENTS_SCOPE_KEY, label: '附件管理' },
];

export const SCOPE_KEYS = new Set(SCOPE_FORM_REGISTRY.map((item) => item.scopeKey));
