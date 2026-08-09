/**
 * 公共上传路由(§19 / §20):
 * GET  /u/:token  -> 上传页面
 * POST /u/:token  -> 提交文件(原子领取租约)
 */

import type { Context } from 'hono';
import {
  ApiError,
  inboxAlreadyUsed,
  inboxExpired,
  inboxNotFound,
  inboxRevoked,
  inboxUploadInProgress,
  invalidRequest,
} from '../errors';
import { ErrorPage } from '../pages/error-page';
import { SuccessPage } from '../pages/success-page';
import { UploadPage } from '../pages/upload-page';
import { services } from '../util/services';
import { errorJson } from '../util/response';
import { isExpired, nowMs } from '../util/time';
import { getRequestId } from '../middleware/request-id';
import { ipHashOf } from '../middleware/ip-hash';
import { wantsJson } from './public-download';
import { completeInboxUploadSchema, initiateInboxUploadSchema } from '../schemas/upload';
import { toIso } from '../util/time';
import { parseJsonBody } from '../util/json-body';
import { resolveLocale, type Locale } from '../i18n';

export async function publicUploadPageHandler(c: Context): Promise<Response> {
  const s = services(c);
  const locale = resolveLocale(c);
  applyPublicUploadHeaders(c, s.env.R2_ACCOUNT_ID, locale);
  const token = c.req.param('token') ?? '';
  const inbox = await s.inboxes.getPublicPage(token);
  if (!inbox) return c.html(<ErrorPage error={inboxNotFound()} locale={locale} />, 404);

  const now = nowMs();
  if (inbox.status === 'expired' || isExpired(inbox.expires_at, now)) {
    return c.html(<ErrorPage error={inboxExpired()} locale={locale} />, 410);
  }
  if (inbox.status === 'revoked') return c.html(<ErrorPage error={inboxRevoked()} locale={locale} />, 410);
  if (inbox.status === 'completed') return c.html(<ErrorPage error={inboxAlreadyUsed()} locale={locale} />, 410);
  if (inbox.status === 'uploading' && inbox.upload_lease_until && inbox.upload_lease_until > now) {
    return c.html(<ErrorPage error={inboxUploadInProgress()} locale={locale} />, 409);
  }
  return c.html(<UploadPage inbox={inbox} token={token} locale={locale} />);
}

export async function publicUploadInitiateHandler(c: Context): Promise<Response> {
  const s = services(c);
  const locale = resolveLocale(c);
  applyPublicUploadHeaders(c, s.env.R2_ACCOUNT_ID, locale);
  const token = c.req.param('token') ?? '';
  const requestId = getRequestId(c);
  const ipHash = await ipHashOf(c);
  const userAgent = c.req.header('user-agent') ?? null;

  let body: unknown;
  try {
    body = await parseJsonBody(c);
  } catch (error) {
    if (error instanceof ApiError) return errorJson(error, requestId);
    throw error;
  }
  const parsed = initiateInboxUploadSchema.safeParse(body);
  if (!parsed.success) return errorJson(invalidRequest('Invalid request body.'), requestId);

  const result = await s.inboxes.initiateUpload({
    token,
    filename: parsed.data.filename,
    description: parsed.data.description,
    sizeBytes: parsed.data.size_bytes,
    contentType: parsed.data.content_type,
    requestId,
    ipHash,
    userAgent,
  });
  if (!result.success) {
    return errorJson(result.error, requestId);
  }
  return okDirectJson({
    file_id: result.file.id,
    upload_id: result.uploadId,
    upload_url: result.upload.url,
    upload_method: result.upload.method,
    upload_headers: result.upload.headers,
    upload_expires_at: toIso(result.upload.expiresAt),
  }, 201);
}

export async function publicUploadCompleteHandler(c: Context): Promise<Response> {
  const s = services(c);
  const locale = resolveLocale(c);
  applyPublicUploadHeaders(c, s.env.R2_ACCOUNT_ID, locale);
  const token = c.req.param('token') ?? '';
  const requestId = getRequestId(c);
  const ipHash = await ipHashOf(c);
  const userAgent = c.req.header('user-agent') ?? null;
  let body: unknown;
  try {
    body = await parseJsonBody(c);
  } catch (error) {
    if (error instanceof ApiError) return errorJson(error, requestId);
    throw error;
  }
  const parsed = completeInboxUploadSchema.safeParse(body);
  if (!parsed.success) return errorJson(invalidRequest('Invalid request body.'), requestId);
  const result = await s.inboxes.completeUpload({
    token,
    fileId: parsed.data.file_id,
    uploadId: parsed.data.upload_id,
    requestId,
    ipHash,
    userAgent,
  });
  if (!result.success) {
    if (wantsJson(c)) return errorJson(result.error, requestId);
    return c.html(<ErrorPage error={result.error} locale={locale} />, result.error.status as 400 | 404 | 409 | 410 | 500);
  }
  if (wantsJson(c)) return okDirectJson({ file: { id: result.file.id, filename: result.file.original_name } });
  return c.html(<SuccessPage filename={result.file.original_name} locale={locale} />);
}

function okDirectJson(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

function applyPublicUploadHeaders(c: Context, accountId: string, locale: Locale): void {
  c.header('Cache-Control', 'private, no-store');
  c.header('Content-Language', locale);
  c.header('Vary', 'Accept-Language');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' https://${accountId}.r2.cloudflarestorage.com`,
  ].join('; '));
}
