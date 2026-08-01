/**
 * Root 审计与统计路由(§13.3 / §26 / §27.3):
 * GET /api/root/audit  全量审计
 * GET /api/root/stats  全局统计
 */

import type { Hono, Context } from 'hono';
import { invalidRequest } from '../errors';
import { rootAuth } from '../middleware/root-auth';
import { auditListQuerySchema } from '../schemas/query';
import { okJson } from '../util/response';
import { services } from '../util/services';

export function rootAuditRoutes(app: Hono): void {
  app.get('/audit', rootAuth(), async (c: Context) => {
    const s = services(c);
    const parsed = auditListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await s.audit.list(undefined, {
      action: q.action,
      resourceType: q.resource_type,
      resourceId: q.resource_id,
      cursor: q.cursor,
      limit: q.limit,
    });
    return okJson({ events: res.rows, next_cursor: res.nextCursor });
  });
}

export function rootStatsRoutes(app: Hono): void {
  app.get('/stats', rootAuth(), async (c: Context) => {
    const s = services(c);
    const stats = await s.stats.rootStats();
    return okJson({ stats });
  });
}
