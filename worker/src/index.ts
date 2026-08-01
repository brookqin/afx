/**
 * Agent File Exchange Worker 入口。
 * 组装中间件、公共路由、普通 API 路由与 Root 路由,并处理 Cron 清理。
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from './env';
import { ApiError, internalError, notFound } from './errors';
import { requestIdMiddleware, getRequestId } from './middleware/request-id';
import { notFoundHandler } from './middleware/error-handler';
import { errorJson } from './util/response';
import { buildServices, setServices } from './util/services';
import { publicDownloadHandler } from './routes/public-download';
import { publicUploadCompleteHandler, publicUploadInitiateHandler, publicUploadPageHandler } from './routes/public-upload';
import { tenantFilesRoutes } from './routes/tenant-files';
import { tenantInboxesRoutes } from './routes/tenant-inboxes';
import { tenantAuditRoutes, tenantStatsRoutes } from './routes/tenant-audit';
import { rootKeysRoutes } from './routes/root-keys';
import { rootFilesRoutes } from './routes/root-files';
import { rootInboxesRoutes } from './routes/root-inboxes';
import { rootAuditRoutes, rootStatsRoutes } from './routes/root-audit';
import { CleanupService } from './services/cleanup-service';
import { AuditService } from './services/audit-service';
import { localeQuery, messages, resolveLocale } from './i18n';

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', requestIdMiddleware);
  app.use('*', async (c: Context, next) => {
    setServices(c, buildServices(c.env as Env));
    await next();
  });

  // 统一错误处理(§14):异常转换为 JSON 响应,附带 request_id
  app.onError((err, c) => {
    const requestId = getRequestId(c);
    if (err instanceof ApiError) {
      if (err.logMessage) console.error(`[${requestId}] ${err.logMessage}`);
      return errorJson(err, requestId);
    }
    if (err instanceof HTTPException) {
      return errorJson(new ApiError('invalid_request', err.status, err.message), requestId);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${requestId}] unhandled error:`, err);
    return errorJson(internalError(undefined, msg), requestId);
  });

  // 公共路由(§13.1)
  app.get('/', (c: Context) => {
    const locale = resolveLocale(c);
    const copy = messages(locale);
    c.header('Content-Language', locale);
    c.header('Vary', 'Accept-Language');
    return c.html(`<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><title>Agent File Exchange</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#1f2329}h1{font-size:24px}p{color:#5f6368;line-height:1.7}.locale{float:right;font-size:14px}.locale a{color:#2563eb;text-decoration:none}.locale a[aria-current=page]{font-weight:700;color:#111827}</style>
</head><body>
<nav class="locale" aria-label="Language"><a href="?lang=${localeQuery('zh-CN')}"${locale === 'zh-CN' ? ' aria-current="page"' : ''}>中文</a> / <a href="?lang=${localeQuery('en')}"${locale === 'en' ? ' aria-current="page"' : ''}>EN</a></nav>
<h1>Agent File Exchange</h1>
<p>${copy.homeDescription}</p>
<p>${copy.homeAudience}</p>
</body></html>`);
  });
  app.get('/healthz', (c: Context) =>
    c.json({ ok: true, status: 'ok', time: new Date().toISOString() }),
  );

  app.get('/d/:token', publicDownloadHandler);
  app.get('/u/:token', publicUploadPageHandler);
  app.post('/u/:token/initiate', publicUploadInitiateHandler);
  app.post('/u/:token/complete', publicUploadCompleteHandler);

  // 普通 API Key 路由(§13.2)
  const tenant = new Hono();
  tenantFilesRoutes(tenant);
  tenantInboxesRoutes(tenant);
  tenantAuditRoutes(tenant);
  tenantStatsRoutes(tenant);
  app.route('/api', tenant);

  // Root 路由(§13.3)
  const root = new Hono();
  rootKeysRoutes(root);
  rootFilesRoutes(root);
  rootInboxesRoutes(root);
  rootAuditRoutes(root);
  rootStatsRoutes(root);
  app.route('/api/root', root);

  app.notFound(notFoundHandler);
  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,

  /** §25 Cron 清理:每小时执行。 */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const audit = new AuditService(env);
    const cleanup = new CleanupService(env, audit);
    ctx.waitUntil(
      cleanup.run().then(
        (r) => console.log('[cleanup]', JSON.stringify(r)),
        (err) => console.error('[cleanup] failed:', err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
