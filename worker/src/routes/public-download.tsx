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
import { DownloadPage } from '../pages/download-page';
import { toIso } from '../util/time';

export async function publicDownloadPageHandler(c: Context): Promise<Response> {
  const s = services(c);
  const locale = resolveLocale(c);
  const token = c.req.param('token') ?? '';
  const requestId = getRequestId(c);
  const res = await s.files.publicFileInfo(token);
  if ('error' in res) {
    if (wantsJson(c)) return errorJson(res.error, requestId);
    applyPublicPageHeaders(c, locale);
    return c.html(<ErrorPage error={res.error} locale={locale} />, res.error.status as 400 | 404 | 409 | 410 | 500);
  }

  const base = s.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const data = {
    filename: res.file.original_name,
    size_bytes: res.file.size_bytes,
    description: res.file.description,
    content_type: res.file.content_type ?? 'application/octet-stream',
    uploaded_at: toIso(res.file.ready_at ?? res.file.created_at),
    expires_at: toIso(res.file.expires_at),
    download_url: `${base}/d/${token}/file`,
  };
  applyPublicPageHeaders(c, locale);
  if (wantsJson(c)) return Response.json({ ok: true, data, request_id: requestId });
  return c.html(<DownloadPage file={res.file} token={token} locale={locale} publicBaseUrl={base} />);
}

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

function applyPublicPageHeaders(c: Context, locale: 'en' | 'zh-CN'): void {
  applyPublicErrorHeaders(c, locale);
  c.header('Vary', 'Accept, Accept-Language');
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'");
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
}
