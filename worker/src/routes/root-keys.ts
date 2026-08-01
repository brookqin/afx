/**
 * Root API Key 管理路由(§23):
 * POST   /api/root/keys           创建(唯一一次返回完整 Key)
 * GET    /api/root/keys           列表
 * GET    /api/root/keys/:id       详情
 * PATCH  /api/root/keys/:id       禁用/恢复/修改
 * DELETE /api/root/keys/:id       吊销(带资源策略)
 */

import type { Hono, Context } from 'hono';
import {
  invalidRequest,
  notFound,
} from '../errors';
import { rootAuth, getRootMeta } from '../middleware/root-auth';
import {
  createApiKey,
  getApiKeyById,
  listApiKeys,
  updateApiKeyStatus,
} from '../repositories/api-key-repository';
import { revokeInboxesByOwner } from '../repositories/inbox-repository';
import * as fileRepo from '../repositories/file-repository';
import { generateApiKey, apiKeySecretHash, parseApiKey } from '../security/token';
import {
  createKeySchema,
  patchKeySchema,
  deleteKeySchema,
} from '../schemas/root';
import { keyListQuerySchema } from '../schemas/query';
import { apiKeyToApi } from '../util/serialize';
import { okJson } from '../util/response';
import { services } from '../util/services';
import { ulid } from '../util/id';
import { toIso } from '../util/time';
import { SCOPES, isScope } from '../services/auth-service';
import { parseJsonBody } from '../util/json-body';

export function rootKeysRoutes(app: Hono): void {
  // 创建(§23.1)
  app.post('/keys', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);

    const body = await parseJsonBody(c);
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) throw invalidRequest('Invalid request body.');

    const b = parsed.data;
    const defaultExpireSeconds = b.default_expire_seconds ?? 86400;
    const maxExpireSeconds = b.max_expire_seconds ?? 604800;
    if (defaultExpireSeconds > maxExpireSeconds) {
      throw invalidRequest('default_expire_seconds cannot exceed max_expire_seconds.');
    }
    const scopes = (b.scopes ?? [...SCOPES]).filter(isScope);
    const now = Date.now();
    const id = ulid(now);
    const { apiKey, secretPrefix } = generateApiKey(id);
    const apiKeyParts = parseApiKey(apiKey);
    const secretHash = await apiKeySecretHash(s.env.API_KEY_PEPPER, apiKeyParts!.secret);

    await createApiKey(s.env.DB, {
      id,
      name: b.name,
      secretHash,
      secretPrefix,
      scopes,
      status: 'active',
      createdBy: 'root',
      maxFileSizeBytes: b.max_file_size_bytes ?? Number(s.env.DEFAULT_MAX_FILE_SIZE_BYTES || 104857600),
      maxStorageBytes: b.max_storage_bytes ?? null,
      maxActiveFiles: b.max_active_files ?? null,
      defaultExpireSeconds,
      maxExpireSeconds,
      metadata: b.metadata,
    });

    await s.audit.record({
      ownerKeyId: id,
      actorType: 'root_key',
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: id,
      result: 'success',
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      metadata: { scope: scopes.join(',') },
    });

    return okJson(
      {
        id,
        name: b.name,
        api_key: apiKey,
        secret_prefix: secretPrefix,
        scopes,
        created_at: toIso(now),
      },
      { status: 201 },
    );
  });

  // 列表
  app.get('/keys', rootAuth(), async (c: Context) => {
    const s = services(c);
    const parsed = keyListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalidRequest('Invalid query parameters.');
    const q = parsed.data;
    const res = await listApiKeys(s.env.DB, { cursor: q.cursor, limit: q.limit });
    return okJson({ keys: res.rows.map(apiKeyToApi), next_cursor: res.nextCursor });
  });

  // 详情
  app.get('/keys/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const key = await getApiKeyById(s.env.DB, c.req.param('id')!);
    if (!key) throw notFound('API key not found.');
    return okJson({ key: apiKeyToApi(key) });
  });

  // 修改(§23.2:禁用/恢复,revoked 不可恢复)
  app.patch('/keys/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);
    const id = c.req.param('id')!;

    const body = await parseJsonBody(c);
    const parsed = patchKeySchema.safeParse(body);
    if (!parsed.success) throw invalidRequest('Invalid request body.');
    const b = parsed.data;

    const key = await getApiKeyById(s.env.DB, id);
    if (!key) throw notFound('API key not found.');
    const nextDefaultExpire = b.default_expire_seconds ?? key.default_expire_seconds;
    const nextMaxExpire = b.max_expire_seconds ?? key.max_expire_seconds;
    if (nextDefaultExpire > nextMaxExpire) {
      throw invalidRequest('default_expire_seconds cannot exceed max_expire_seconds.');
    }

    if (b.status) {
      if (b.status === 'active' && key.status === 'revoked') {
        throw invalidRequest('A revoked API key cannot be re-activated.');
      }
      if (b.status === 'disabled' && key.status === 'revoked') {
        throw invalidRequest('A revoked API key cannot be disabled.');
      }
      await updateApiKeyStatus(s.env.DB, id, b.status, Date.now());
      const action = b.status === 'disabled' ? 'api_key.disabled' : b.status === 'active' ? 'api_key.enabled' : 'api_key.revoked';
      await s.audit.record({
        ownerKeyId: id,
        actorType: 'root_key',
        action,
        resourceType: 'api_key',
        resourceId: id,
        result: 'success',
        requestId: meta.requestId,
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        metadata: { status: b.status },
      });
    }

    if (Object.keys(b).some((field) => field !== 'status')) {
      await patchKeyFields(s.env.DB, id, b);
      await s.audit.record({
        ownerKeyId: id,
        actorType: 'root_key',
        action: 'api_key.updated',
        resourceType: 'api_key',
        resourceId: id,
        result: 'success',
        requestId: meta.requestId,
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        metadata: { fields: Object.keys(b).filter((field) => field !== 'status').sort().join(',') },
      });
    }

    const updated = await getApiKeyById(s.env.DB, id);
    return okJson({ key: updated ? apiKeyToApi(updated) : null });
  });

  // 吊销(§23.3,默认 keep)
  app.delete('/keys/:id', rootAuth(), async (c: Context) => {
    const s = services(c);
    const meta = getRootMeta(c);
    const id = c.req.param('id')!;

    const body = await parseJsonBody(c, { allowEmpty: true });
    const parsed = deleteKeySchema.safeParse(body);
    if (!parsed.success) throw invalidRequest('Invalid request body.');
    const policy = parsed.data.resource_policy;

    const key = await getApiKeyById(s.env.DB, id);
    if (!key) throw notFound('API key not found.');
    if (key.status === 'revoked') {
      // 幂等:已吊销直接返回
      return okJson({ id, status: 'revoked', resource_policy: policy });
    }

    const now = Date.now();
    await updateApiKeyStatus(s.env.DB, id, 'revoked', now);

    if (policy === 'revoke_inboxes' || policy === 'revoke_all' || policy === 'delete_all') {
      await revokeInboxesByOwner(s.env.DB, id, now);
    }

    if (policy === 'revoke_all' || policy === 'delete_all') {
      // 将所有 ready 文件置为 deleted,并异步删除 R2 对象
      await markAllReadyFilesDeleted(s.env.DB, id, now);
      c.executionCtx.waitUntil(
        deleteR2ObjectsForOwner(s.env, id).catch((err) =>
          console.error(`[root] failed to delete R2 objects for ${id}:`, err),
        ),
      );
    }

    await s.audit.record({
      ownerKeyId: id,
      actorType: 'root_key',
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: id,
      result: 'success',
      requestId: meta.requestId,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      metadata: { resource_policy: policy },
    });

    return okJson({ id, status: 'revoked', resource_policy: policy });
  });
}

async function patchKeyFields(
  db: D1Database,
  id: string,
  b: {
    name?: string;
    max_file_size_bytes?: number;
    max_storage_bytes?: number | null;
    max_active_files?: number | null;
    default_expire_seconds?: number;
    max_expire_seconds?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE api_keys SET
         name = COALESCE(?, name),
         max_file_size_bytes = COALESCE(?, max_file_size_bytes),
         max_storage_bytes = CASE WHEN ? THEN ? ELSE max_storage_bytes END,
         max_active_files = CASE WHEN ? THEN ? ELSE max_active_files END,
         default_expire_seconds = COALESCE(?, default_expire_seconds),
         max_expire_seconds = COALESCE(?, max_expire_seconds),
         metadata_json = CASE WHEN ? THEN ? ELSE metadata_json END
       WHERE id = ?`,
    )
    .bind(
      b.name ?? null,
      b.max_file_size_bytes ?? null,
      b.max_storage_bytes !== undefined ? 1 : 0,
      b.max_storage_bytes ?? null,
      b.max_active_files !== undefined ? 1 : 0,
      b.max_active_files ?? null,
      b.default_expire_seconds ?? null,
      b.max_expire_seconds ?? null,
      b.metadata !== undefined ? 1 : 0,
      b.metadata !== undefined ? JSON.stringify(b.metadata) : null,
      id,
    )
    .run();
}

async function markAllReadyFilesDeleted(db: D1Database, ownerKeyId: string, now: number): Promise<void> {
  await db
    .prepare(`UPDATE files SET status = 'deleted', deleted_at = ? WHERE owner_key_id = ? AND status = 'ready'`)
    .bind(now, ownerKeyId)
    .run();
}

async function deleteR2ObjectsForOwner(env: { FILES: R2Bucket }, ownerKeyId: string): Promise<void> {
  // R2 list 分页删除(仅删除该租户前缀下的对象)
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix: `objects/${ownerKeyId}/`, cursor });
    cursor = listed.truncated ? listed.cursor : undefined;
    if (listed.objects.length > 0) {
      await env.FILES.delete(listed.objects.map((o) => o.key));
    }
  } while (cursor);
}
