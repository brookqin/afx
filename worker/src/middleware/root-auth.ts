/**
 * Root 认证中间件:只允许 afx_root_<secret>,仅用于 /api/root/* 路由。
 */

import type { Context, Next } from 'hono';
import { services } from '../util/services';
import { getRequestId } from './request-id';
import { ipHashOf } from './ip-hash';

export function rootAuth() {
  return async function rootAuthMiddleware(c: Context, next: Next): Promise<void> {
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    await services(c).auth.verifyRoot(bearer);
    c.set('rootAuthMeta', {
      requestId: getRequestId(c),
      ipHash: await ipHashOf(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    await next();
  };
}

export function getRootMeta(c: Context): { requestId: string; ipHash: string | null; userAgent: string | null } {
  return c.get('rootAuthMeta') as { requestId: string; ipHash: string | null; userAgent: string | null };
}
