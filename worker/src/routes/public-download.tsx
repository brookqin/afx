/**
 * 公共下载路由 GET /d/:token(§16)。
 * 浏览器 -> HTML 错误页;Accept: application/json -> 统一 JSON 错误。
 */

import type { Context } from 'hono';
import { fileNotFound } from '../errors';
import { ErrorPage } from '../pages/error-page';
import { services } from '../util/services';
import { errorJson } from '../util/response';
import * as fileRepo from '../repositories/file-repository';
import { getRequestId } from '../middleware/request-id';
import { ipHashOf } from '../middleware/ip-hash';
import { resolveLocale } from '../i18n';

export async function publicDownloadHandler(c: Context): Promise<Response> {
  const s = services(c);
  const locale = resolveLocale(c);
  const token = c.req.param('token') ?? '';
  const requestId = getRequestId(c);
  const ipHash = await ipHashOf(c);
  const userAgent = c.req.header('user-agent') ?? null;

  const res = await s.files.publicDownload(token, { requestId, ipHash, userAgent });
  if ('error' in res) {
    const err = res.error;
    await s.audit.record({
      ownerKeyId: null,
      actorType: 'public_download',
      action: 'file.download_denied',
      resourceType: 'file',
      result: 'denied',
      requestId,
      ipHash,
      userAgent,
      metadata: { reason: err.code },
    });
    if (wantsJson(c)) return errorJson(err, requestId);
    applyPublicErrorHeaders(c, locale);
    return c.html(<ErrorPage error={err} locale={locale} />, err.status as 400 | 404 | 410 | 409 | 500);
  }

  const obj = await s.files.getObject(res.file.object_key);
  if (!obj) {
    const err = fileNotFound('File storage object is missing.');
    // 记录失败下载(§27.1 failed_download_count)
    await fileRepo.incrementFailedDownload(s.env.DB, res.file.id);
    await s.audit.record({
      ownerKeyId: res.file.owner_key_id,
      actorType: 'public_download',
      action: 'file.download_denied',
      resourceType: 'file',
      resourceId: res.file.id,
      result: 'failed',
      requestId,
      ipHash,
      userAgent,
      metadata: { reason: 'r2_object_missing' },
    });
    if (wantsJson(c)) return errorJson(err, requestId);
    applyPublicErrorHeaders(c, locale);
    return c.html(<ErrorPage error={err} locale={locale} />, 404);
  }

  const response = s.files.buildDownloadResponse(res.file, obj.body);
  if (res.burn) {
    // 阅后即焚:下载权已授予,异步删除 R2 对象(传输中断也视为已消耗,§16.3)
    const key = res.file.object_key;
    c.executionCtx.waitUntil(s.env.FILES.delete(key).catch(() => {}));
  }
  return response;
}

export function wantsJson(c: Context): boolean {
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/json');
}

function applyPublicErrorHeaders(c: Context, locale: 'en' | 'zh-CN'): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('Content-Language', locale);
  c.header('Vary', 'Accept-Language');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
}
