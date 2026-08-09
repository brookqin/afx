import type { Context, Hono } from 'hono';
import { tenantAuth, getAuthKey } from '../middleware/tenant-auth';
import { okJson } from '../util/response';

/** Authenticated configuration probe. It requires no business scope. */
export function tenantStatusRoutes(app: Hono): void {
  app.get('/status', tenantAuth(), (c: Context) => {
    const key = getAuthKey(c);
    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(key.scopes_json);
      if (Array.isArray(parsed)) scopes = parsed.map(String);
    } catch {
      scopes = [];
    }
    return okJson({
      authenticated: true,
      server_time: new Date().toISOString(),
      key: {
        id: key.id,
        name: key.name,
        scopes,
        max_file_size_bytes: key.max_file_size_bytes,
        default_expire_seconds: key.default_expire_seconds,
        max_expire_seconds: key.max_expire_seconds,
      },
    });
  });
}
