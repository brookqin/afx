/**
 * 统一 API 响应格式(设计文档 §14):
 * 成功: { "ok": true, "data": {} }
 * 失败: { "ok": false, "error": { code, message, details? }, "request_id" }
 */

import { ApiError } from '../errors';

export function okJson(data: unknown, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

export function errorJson(error: ApiError, requestId: string | null, init?: ResponseInit): Response {
  const body: Record<string, unknown> = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    },
  };
  if (requestId) body.request_id = requestId;
  return Response.json(body, { status: error.status, ...init });
}
