/**
 * Request ID 中间件:每个请求生成 ULID,存入上下文变量,并写入响应头 X-Request-Id。
 * 同时记录请求开始时间,供审计使用。
 */

import type { Context, Next } from 'hono';
import { ulid } from '../util/id';

export const REQUEST_ID_KEY = 'requestId';
export const REQUEST_START_KEY = 'requestStartedAt';

export async function requestIdMiddleware(c: Context, next: Next): Promise<void> {
  const id = ulid();
  c.set(REQUEST_ID_KEY, id);
  c.set(REQUEST_START_KEY, Date.now());
  await next();
  c.header('X-Request-Id', id);
}

export function getRequestId(c: Context): string {
  return c.get(REQUEST_ID_KEY) as string;
}

export function getRequestStart(c: Context): number {
  return (c.get(REQUEST_START_KEY) as number) ?? Date.now();
}

/** 请求日志:脱敏后输出。任何位置都不打印 Authorization、Token、Secret。 */
export function logRequest(c: Context, level: 'info' | 'warn' | 'error' = 'info'): void {
  const id = getRequestId(c);
  const method = c.req.method;
  const url = c.req.url;
  const status = c.res.status;
  const ms = Date.now() - getRequestStart(c);
  console[level](`${id} ${method} ${url} -> ${status} (${ms}ms)`);
}
