import { requestContext } from './request-context';

const SENSITIVE = /password|passwd|pwd|token|secret|authorization|cookie|spk|loginid/i;

export function sanitizeLogValue(input: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof input === 'string') return input.slice(0, 1000).replace(/((?:password|token|secret|authorization|cookie)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]');
  if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input !== 'object') return String(input).slice(0, 100);
  if (depth >= 6) return '[DEPTH_LIMIT]';
  if (seen.has(input)) return '[CIRCULAR]';
  seen.add(input);
  if (Array.isArray(input)) {
    const items = input.slice(0, 30).map(value => sanitizeLogValue(value, depth + 1, seen));
    return input.length > 30 ? [...items, { omitted: input.length - 30 }] : items;
  }
  if (input instanceof Date) return input.toISOString();
  const result: Record<string, unknown> = {};
  const entries = Object.entries(input);
  for (const [key, value] of entries.slice(0, 40)) {
    Object.defineProperty(result, key, { enumerable: true, value: SENSITIVE.test(key) ? '[REDACTED]' : sanitizeLogValue(value, depth + 1, seen) });
  }
  if (entries.length > 40) result.omittedFields = entries.length - 40;
  return result;
}

/** 所有审计入口共同执行脱敏和大小限制；始终返回有效 JSON。 */
export function serializeAuditDetail(input: unknown): string {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); } catch { parsed = { summary: input }; }
  }
  const sanitized = sanitizeLogValue(parsed);
  const requestId = requestContext.getStore()?.requestId;
  const detail = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? { ...sanitized, ...(requestId ? { requestId } : {}) }
    : { ...(requestId ? { requestId } : {}), ...(sanitized == null ? {} : { value: sanitized }) };
  const json = JSON.stringify(detail);
  if (json.length <= 8000) return json;
  return JSON.stringify({ requestId, truncated: true, fields: Object.keys(detail).slice(0, 40), summary: '详情超出日志大小上限' });
}
