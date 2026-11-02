import { ATTACHMENT_TARGET_REGISTRY } from './attachment-targets.registry';
import { EXAMPLE_ITEMS_SCOPE_KEY } from '../example/example.service';

/** 注册表与示例模块常量必须一致：sourceType 对应 ChildSpec sourceType，scopeKey 对应业务 dataScopeKey */
describe('attachment-targets.registry 防漂移', () => {
  it('示例事项登记与业务模块 scopeKey/sourceType 一致', () => {
    const entry = ATTACHMENT_TARGET_REGISTRY.find(item => item.sourceType === 'example-items');
    expect(entry).toBeDefined();
    expect(entry!.scopeKey).toBe(EXAMPLE_ITEMS_SCOPE_KEY);
    expect(entry!.table).toBe('example_items');
  });
});
