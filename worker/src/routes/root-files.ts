/**
 * Root 文件路由(§13.3):
 * GET    /api/root/files          全量列表(支持 owner_key_id / filename 过滤)
 * GET    /api/root/files/:id      详情
 * GET    /api/root/files/:id/content 下载
 * DELETE /api/root/files/:id      删除
 */

import type { Hono, Context } from 'hono';
import { fileNotFound, invalidRequest } from '../errors';
import { rootAuth, getRootMeta } from '../middleware/root-auth';
import { fileListQuerySchema } from '../schemas/query';
import { fileToApi } from '../util/serialize';
import { okJson } from '../util/response';
import { services } from '../util/services';
import * as fileRepo from '../repositories/file-repository';

export function rootFilesRoutes(app: Hono): void {
  // 全量列表(§22.2)
  app.get('/files', rootAuth(), async (c: Context) => {
    const s = services(c);
    const parsed = fileListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;

    const opts: fileRepo.FileListOptions = {
      ownerKeyId: q.owner_key_id || undefined,
      status: q.status,
      source: q.source,
      createdFrom: q.created_from,
      createdTo: q.created_to,
      filename: q.filename || undefined,
      cursor: q.cursor,
      limit: q.limit,
    };

    const rows = await s.files.list(opts);
    return okJson({ files: rows.rows.map(fileToApi), next_cursor: rows.nextCursor });
  });

  // 详情
  app.get('/files/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const file = await s.files.getAny(c.req.param('id')!);
    if (!file) throw fileNotFound();
    return okJson({ file: fileToApi(file) });
  });

  // 下载(遵循文件状态规则,§17)
  app.get('/files/:id/content', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);
    const file = await s.files.getAny(c.req.param('id')!);
    if (!file) throw fileNotFound();
    const res = await s.files.privateDownload(file.id, file.owner_key_id);
    if ('error' in res) throw res.error;
    await s.audit.record({
      ownerKeyId: file.owner_key_id,
      actorType: 'root_key',
      action: 'file.private_downloaded',
      resourceType: 'file',
      resourceId: file.id,
      result: 'success',
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      metadata: { filename: file.original_name, size_bytes: file.size_bytes },
    });
    return s.files.buildDownloadResponse(res.file, res.body);
  });

  // 删除
  app.delete('/files/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);
    const file = await s.files.deleteFile(c.req.param('id')!, null, {
      ...meta,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    if (!file) throw fileNotFound();
    return okJson({ id: file.id, status: 'deleted' });
  });
}
