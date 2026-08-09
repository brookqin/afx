/**
 * 普通 API Key 接收邀请路由(§13.2 / §21):
 * POST   /api/inboxes          创建一次性上传链接
 * GET    /api/inboxes          列表
 * GET    /api/inboxes/:id      详情(含已接收文件摘要)
 * GET    /api/inboxes/:id/file 下载收到的文件
 * DELETE /api/inboxes/:id      撤销
 */

import type { Hono, Context } from 'hono';
import { inboxNotFound, invalidRequest } from '../errors';
import { tenantAuth, getAuthKey, getAuthMeta } from '../middleware/tenant-auth';
import { createInboxSchema } from '../schemas/inbox';
import { inboxListQuerySchema } from '../schemas/query';
import { inboxToApi } from '../util/serialize';
import { okJson } from '../util/response';
import { services } from '../util/services';
import { parseEnvBytes } from '../env';
import { toIso } from '../util/time';
import { parseJsonBody } from '../util/json-body';

export function tenantInboxesRoutes(app: Hono): void {
  // 创建(§18)
  app.post('/inboxes', tenantAuth('inboxes:create'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);

    const body = await parseJsonBody(c);
    const parsed = createInboxSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest('Invalid request body.');

    const b = parsed.data;
    const maxFileSizeBytes = Math.min(
      b.max_file_size_bytes ?? parseEnvBytes(s.env.DEFAULT_MAX_FILE_SIZE_BYTES),
      key.max_file_size_bytes,
    );

    const result = await s.inboxes.create({
      ownerKeyId: key.id,
      actorId: key.id,
      expiresIn: b.expires_in,
      maxFileSizeBytes,
      defaultExpireSeconds: key.default_expire_seconds,
      maxExpireSeconds: key.max_expire_seconds,
      title: b.title ?? null,
      description: b.description ?? null,
      allowedExtensions: b.allowed_extensions ?? [],
      allowedContentTypes: b.allowed_content_types ?? [],
      expectedFilename: b.expected_filename ?? null,
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
    });

    return okJson(
      {
        id: result.inbox.id,
        upload_url: result.uploadUrl,
        expires_at: toIso(result.inbox.expires_at),
        status: result.inbox.status,
      },
      { status: 201 },
    );
  });

  // 列表
  app.get('/inboxes', tenantAuth('inboxes:list'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const parsed = inboxListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await s.inboxes.list({ ownerKeyId: key.id, status: q.status, cursor: q.cursor, limit: q.limit });
    return okJson({ inboxes: res.rows.map(inboxToApi), next_cursor: res.nextCursor });
  });

  // 详情(§21.1)
  app.get('/inboxes/:id', tenantAuth('inboxes:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const inbox = await s.inboxes.getForOwner(c.req.param('id')!, key.id);
    if (!inbox) throw inboxNotFound();
    const data = inboxToApi(inbox);
    if (inbox.status === 'completed' && inbox.received_file_id) {
      const file = await s.files.getForOwner(inbox.received_file_id, key.id);
      if (file) {
        data.file = {
          id: file.id,
          filename: file.original_name,
          description: file.description,
          size_bytes: file.size_bytes,
          content_type: file.content_type,
          uploaded_at: toIso(file.ready_at ?? file.created_at),
          status: file.status,
        };
      }
    }
    return okJson(data);
  });

  // 下载收到的文件(§21.2)
  app.get('/inboxes/:id/file', tenantAuth('inboxes:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);
    const res = await s.inboxes.downloadReceivedFile(c.req.param('id')!, key.id);
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

  // 撤销(幂等)
  app.delete('/inboxes/:id', tenantAuth('inboxes:delete'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const meta = getAuthMeta(c);
    const inbox = await s.inboxes.revoke(c.req.param('id')!, key.id, meta);
    if (!inbox) throw inboxNotFound();
    return okJson({ id: inbox.id, status: inbox.status });
  });
}
