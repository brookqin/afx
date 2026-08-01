/**
 * 租户认证中间件:校验 Authorization: Bearer <API_KEY>。
 * 认证成功的租户记录写入上下文变量 AUTH_KEY。
 * scope 参数用于按路由校验(如 files:upload)。
 */

import type { Context, Next } from 'hono';
import type { Scope } from '../services/auth-service';
import type { ApiKeyRow } from '../repositories/api-key-repository';
import { services } from '../util/services';
import { getRequestId } from './request-id';
import { ipHashOf } from './ip-hash';

export const AUTH_KEY = 'authKey';

export function tenantAuth(scope?: Scope) {
  return async function tenantAuthMiddleware(c: Context, next: Next): Promise<void> {
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const key = await services(c).auth.verifyApiKey(bearer, scope);
    c.set(AUTH_KEY, key);
    c.set('authRequestMeta', {
      requestId: getRequestId(c),
      ipHash: await ipHashOf(c),
      userAgent: c.req.header('user-agent') ?? null,
    });
    await next();
  };
}

export function getAuthKey(c: Context): ApiKeyRow {
  return c.get(AUTH_KEY) as ApiKeyRow;
}

export function getAuthMeta(c: Context): { requestId: string; ipHash: string | null; userAgent: string | null } {
  return c.get('authRequestMeta') as { requestId: string; ipHash: string | null; userAgent: string | null };
}
