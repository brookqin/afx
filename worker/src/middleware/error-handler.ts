/**
 * 错误处理中间件:统一转换为 §14 响应格式,附带 request_id。
 * 不向客户端泄露 SQL、堆栈、R2 Object Key 或 Secret。
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ApiError, internalError, notFound } from '../errors';
import { errorJson } from '../util/response';
import { getRequestId } from './request-id';

export async function errorHandler(c: Context, next: Next): Promise<void> {
  try {
    await next();
    if (c.res.status === 404 && c.req.method !== 'GET' && c.req.method !== 'POST') {
      // Hono 未匹配的方法
      c.res = errorJson(notFound(), getRequestId(c), { status: 404 });
    }
  } catch (err) {
    const requestId = getRequestId(c);
    if (err instanceof ApiError) {
      if (err.logMessage) console.error(`[${requestId}] ${err.logMessage}`);
      c.res = errorJson(err, requestId);
      return;
    }
    if (err instanceof HTTPException) {
      const wrapped = new ApiError('invalid_request', err.status, err.message);
      c.res = errorJson(wrapped, requestId);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${requestId}] unhandled error:`, err);
    c.res = errorJson(internalError(undefined, msg), requestId);
  }
}

/** 兜底 404:未知路由。 */
export async function notFoundHandler(c: Context): Promise<Response> {
  return errorJson(notFound(), getRequestId(c));
}
