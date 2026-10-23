import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function ensureRequestId(req: Request, res: Response): string {
  const candidate = req['requestId'] ?? req.headers['x-request-id'];
  const requestId = typeof candidate === 'string' && SAFE_ID.test(candidate) ? candidate : randomUUID();
  req['requestId'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  return requestId;
}
