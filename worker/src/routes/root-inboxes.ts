/**
 * Root Inbox 路由(§13.3):
 * GET    /api/root/inboxes    全量列表
 * GET    /api/root/inboxes/:id 详情
 * DELETE /api/root/inboxes/:id 撤销
 */

import type { Hono, Context } from 'hono';
import { inboxNotFound, invalidRequest } from '../errors';
import { rootAuth, getRootMeta } from '../middleware/root-auth';
import { inboxListQuerySchema } from '../schemas/query';
import { inboxToApi } from '../util/serialize';
import { okJson } from '../util/response';
import { services } from '../util/services';

export function rootInboxesRoutes(app: Hono): void {
  app.get('/inboxes', rootAuth(), async (c: Context) => {
    const s = services(c);
    const parsed = inboxListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await s.inboxes.list({ status: q.status, cursor: q.cursor, limit: q.limit });
    return okJson({ inboxes: res.rows.map(inboxToApi), next_cursor: res.nextCursor });
  });

  app.get('/inboxes/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const inbox = await s.inboxes.getAny(c.req.param('id')!);
    if (!inbox) throw inboxNotFound();
    return okJson(inboxToApi(inbox));
  });

  app.delete('/inboxes/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);
    const inbox = await s.inboxes.revoke(c.req.param('id')!, null, meta);
    if (!inbox) throw inboxNotFound();
    return okJson({ id: inbox.id, status: inbox.status });
  });
}
