/** 请求用户 ID、整数解析、日期和单号重试工具。 */

export function getUserId(user?: any): number | null {
  return user?.id ?? user?.userId ?? user?.sub ?? null;
}

export function safeParseInt(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? undefined : n;
}

export function formatDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function withDocNoRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; onRetry?: (attempt: number) => void } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 40, onRetry } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.driverError?.code ?? err?.code;
      const isDup =
        code === 'ER_DUP_ENTRY' || String(err?.message ?? '').includes('Duplicate entry');
      if (!isDup || attempt >= maxAttempts - 1) throw err;
      onRetry?.(attempt + 1);
      // 随机错峰（±20ms），降低并发同号概率
      await new Promise((r) => setTimeout(r, Math.max(10, baseDelayMs - 20 + Math.random() * 40)));
    }
  }
}
