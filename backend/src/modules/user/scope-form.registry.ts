/** 使用数据范围的业务表单注册表。复制示例模块创建新业务时，在这里登记 scopeKey。 */
export const SCOPE_FORM_REGISTRY = [
  { scopeKey: 'example-items', label: '示例事项' },
];

export const SCOPE_KEYS = new Set(SCOPE_FORM_REGISTRY.map((item) => item.scopeKey));
