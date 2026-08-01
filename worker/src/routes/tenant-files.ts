/**
 * 普通 API Key 文件路由(§13.2):
 * POST   /api/files              上传并分享
 * GET    /api/files              列表(游标分页)
 * GET    /api/files/:id          详情
 * GET    /api/files/:id/content  私有下载
 * DELETE /api/files/:id          删除
 * GET    /api/files/:id/stats    下载统计
 *
 * 租户隔离:所有查询强制 owner_key_id = 认证租户(§3.2),不信任客户端参数。
 */

import type { Hono, Context } from 'hono';
import { fileNotFound, invalidRequest } from '../errors';
import { tenantAuth, getAuthKey, getAuthMeta } from '../middleware/tenant-auth';
import { fileListQuerySchema } from '../schemas/query';
import { initiateFileUploadSchema } from '../schemas/upload';
import { fileStatsToApi, fileToApi } from '../util/serialize';
import { okJson } from '../util/response';
import { services } from '../util/services';
import { toIso } from '../util/time';
import { parseJsonBody } from '../util/json-body';

export function tenantFilesRoutes(app: Hono): void {
  // 创建直传会话(§15):Worker 只签名,文件正文由客户端 PUT 到 R2。
  app.post('/files', tenantAuth('files:upload'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);

    const body = await parseJsonBody(c);
    const parsed = initiateFileUploadSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest('Invalid request body.');
    const b = parsed.data;

    const result = await s.files.initiateUpload({
      ownerKeyId: key.id,
      actorId: key.id,
      maxFileSizeBytes: key.max_file_size_bytes,
      defaultExpireSeconds: key.default_expire_seconds,
      maxExpireSeconds: key.max_expire_seconds,
      maxStorageBytes: key.max_storage_bytes,
      maxActiveFiles: key.max_active_files,
      expiresIn: b.expires_in,
      maxDownloads: b.max_downloads ?? null,
      burnAfterRead: b.burn_after_read,
      filename: b.filename,
      contentType: b.content_type,
      sizeBytes: b.size_bytes,
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });

    return okJson(
      {
        id: result.file.id,
        status: 'uploading',
        upload_url: result.upload.url,
        upload_method: result.upload.method,
        upload_headers: result.upload.headers,
        upload_expires_at: toIso(result.upload.expiresAt),
        complete_url: `${s.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/files/${result.file.id}/complete`,
        download_url: result.downloadUrl,
        expires_at: toIso(result.file.expires_at),
      },
      { status: 201 },
    );
  });

  app.post('/files/:id/complete', tenantAuth('files:upload'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);
    const file = await s.files.completeUpload(c.req.param('id')!, key.id, {
      ...meta,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    return okJson({ file: fileToApi(file) });
  });

  // 列表(§22.1)
  app.get('/files', tenantAuth('files:list'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const parsed = fileListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await s.files.list({
      ownerKeyId: key.id,
      status: q.status,
      source: q.source,
      createdFrom: q.created_from,
      createdTo: q.created_to,
      cursor: q.cursor,
      limit: q.limit,
    });
    return okJson({ files: res.rows.map(fileToApi), next_cursor: res.nextCursor });
  });

  // 详情
  app.get('/files/:id', tenantAuth('files:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const file = await s.files.getForOwner(c.req.param('id')!, key.id);
    if (!file) throw fileNotFound();
    return okJson({ file: fileToApi(file) });
  });

  // 私有下载(§17)
  app.get('/files/:id/content', tenantAuth('files:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);
    const res = await s.files.privateDownload(c.req.param('id')!, key.id);
    if ('error' in res) throw res.error;
    await s.audit.record({
      ownerKeyId: key.id,
      actorType: 'api_key',
      actorId: key.id,
      action: 'file.private_downloaded',
      resourceType: 'file',
      resourceId: res.file.id,
      result: 'success',
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      metadata: { filename: res.file.original_name, size_bytes: res.file.size_bytes },
    });
    return s.files.buildDownloadResponse(res.file, res.body);
  });

  // 删除(§24,幂等)
  app.delete('/files/:id', tenantAuth('files:delete'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);
    const file = await s.files.deleteFile(c.req.param('id')!, key.id, {
      ...meta,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    if (!file) throw fileNotFound();
    return okJson({ id: file.id, status: 'deleted' });
  });

  // 统计(§27.1)
  app.get('/files/:id/stats', tenantAuth('files:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const file = await s.files.getForOwner(c.req.param('id')!, key.id);
    if (!file) throw fileNotFound();
    return okJson({ stats: fileStatsToApi(file) });
  });
}
