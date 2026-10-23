import { serializeAuditDetail } from './log-sanitizer';
import { requestContext } from './request-context';

describe('审计详情脱敏和请求关联', () => {
  it('嵌套对象、数组、手工 JSON 均脱敏，保留可核对的前后值', () => {
    const detail = requestContext.run({ requestId: 'req-123' }, () => serializeAuditDetail(JSON.stringify({ old: { name: '旧值' }, new: { name: '新值', users: [{ password: 'secret-value', refreshToken: 'token-value' }] } })));
    const parsed = JSON.parse(detail);
    expect(parsed).toMatchObject({ requestId: 'req-123', old: { name: '旧值' }, new: { name: '新值' } });
    expect(detail).not.toContain('secret-value');
    expect(detail).not.toContain('token-value');
  });
  it('大数组、深层、循环与长文本均可安全序列化，不产生截断 JSON', () => {
    const input: any = { ids: Array.from({ length: 1000 }, (_, i) => i), long: 'a'.repeat(20000) };
    input.loop = input;
    const detail = serializeAuditDetail(input);
    expect(() => JSON.parse(detail)).not.toThrow();
    expect(detail.length).toBeLessThanOrEqual(8000);
    expect(JSON.parse(detail).ids).toHaveLength(31);
    expect(JSON.parse(detail).loop).toBe('[CIRCULAR]');
    expect(serializeAuditDetail(Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['x' + i, 'a'.repeat(1000)])))).toContain('"truncated":true');
  });
});
