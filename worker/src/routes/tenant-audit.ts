/** 租户审计与统计路由:GET /api/audit, GET /api/stats。 */

import type { Hono, Context } from 'hono';
import { invalidRequest } from '../errors';
import { tenantAuth, getAuthKey } from '../middleware/tenant-auth';
import { auditListQuerySchema } from '../schemas/query';
import { okJson } from '../util/response';
import { services } from '../util/services';

export function tenantAuditRoutes(app: Hono): void {
  app.get('/audit', tenantAuth('audit:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const parsed = auditListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await s.audit.list(key.id, {
      action: q.action,
      resourceType: q.resource_type,
      resourceId: q.resource_id,
      cursor: q.cursor,
      limit: q.limit,
    });
    return okJson({ events: res.rows, next_cursor: res.nextCursor });
  });
}

export function tenantStatsRoutes(app: Hono): void {
  app.get('/stats', tenantAuth('stats:read'), async (c: Context) => {
    const s = services(c);
    const key = getAuthKey(c);
    const stats = await s.stats.tenantStats(key.id);
    return okJson({ stats });
  });
}
