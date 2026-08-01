/**
 * api_keys 表仓储。只通过 ID 定位记录,绝不通过明文 Secret 查询。
 */

export type ApiKeyStatus = 'active' | 'disabled' | 'revoked';

export interface ApiKeyRow {
  id: string;
  name: string;
  secret_hash: string;
  secret_prefix: string;
  scopes_json: string;
  status: ApiKeyStatus;
  created_at: number;
  created_by: string;
  last_used_at: number | null;
  disabled_at: number | null;
  revoked_at: number | null;
  max_file_size_bytes: number;
  max_storage_bytes: number | null;
  max_active_files: number | null;
  default_expire_seconds: number;
  max_expire_seconds: number;
  metadata_json: string;
}

export interface CreateApiKeyInput {
  id: string;
  name: string;
  secretHash: string;
  secretPrefix: string;
  scopes: string[];
  status: ApiKeyStatus;
  createdBy: string;
  maxFileSizeBytes: number;
  maxStorageBytes: number | null;
  maxActiveFiles: number | null;
  defaultExpireSeconds: number;
  maxExpireSeconds: number;
  metadata?: Record<string, unknown>;
}

const SELECT_COLUMNS = `
  id, name, secret_hash, secret_prefix, scopes_json, status,
  created_at, created_by, last_used_at, disabled_at, revoked_at,
  max_file_size_bytes, max_storage_bytes, max_active_files,
  default_expire_seconds, max_expire_seconds, metadata_json
`;

function mapRow(r: any): ApiKeyRow {
  return r as ApiKeyRow;
}

export async function createApiKey(db: D1Database, input: CreateApiKeyInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO api_keys (
        id, name, secret_hash, secret_prefix, scopes_json, status,
        created_at, created_by,
        max_file_size_bytes, max_storage_bytes, max_active_files,
        default_expire_seconds, max_expire_seconds, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.name,
      input.secretHash,
      input.secretPrefix,
      JSON.stringify(input.scopes),
      input.status,
      Date.now(),
      input.createdBy,
      input.maxFileSizeBytes,
      input.maxStorageBytes,
      input.maxActiveFiles,
      input.defaultExpireSeconds,
      input.maxExpireSeconds,
      JSON.stringify(input.metadata ?? {}),
    )
    .run();
}

export async function getApiKeyById(db: D1Database, id: string): Promise<ApiKeyRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM api_keys WHERE id = ?`)
    .bind(id)
    .first();
  return res ? mapRow(res) : null;
}

export async function getApiKeyBySecretPrefix(
  db: D1Database,
  secretPrefix: string,
): Promise<ApiKeyRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM api_keys WHERE secret_prefix = ? LIMIT 1`)
    .bind(secretPrefix)
    .first();
  return res ? mapRow(res) : null;
}

export interface ApiKeyListOptions {
  cursor?: string;
  limit: number;
}

export interface ApiKeyListResult {
  rows: ApiKeyRow[];
  nextCursor: string | null;
}

/** 游标分页:按 created_at DESC, id DESC。cursor 编码为 "created_at:id"。 */
export async function listApiKeys(
  db: D1Database,
  opts: ApiKeyListOptions,
): Promise<ApiKeyListResult> {
  const limit = opts.limit;
  let createdAtCursor: number | null = null;
  let idCursor: string | null = null;
  if (opts.cursor) {
    const parts = opts.cursor.split(':');
    if (parts.length === 2) {
      createdAtCursor = Number(parts[0]);
      idCursor = parts[1]!;
    }
  }

  const rows = await (async () => {
    if (createdAtCursor != null && idCursor != null) {
      return db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM api_keys
           WHERE (created_at, id) < (?, ?)
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .bind(createdAtCursor, idCursor, limit + 1)
        .all();
    }
    return db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM api_keys ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(limit + 1)
      .all();
  })();

  const list = (rows.results ?? []).map(mapRow);
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}:${last.id}` : null;
  return { rows: page, nextCursor };
}

/** 更新状态;disabled/revoked 时写对应时间戳。 */
export async function updateApiKeyStatus(
  db: D1Database,
  id: string,
  status: ApiKeyStatus,
  at: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE api_keys SET status = ?,
        disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE disabled_at END,
        revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END
       WHERE id = ?`,
    )
    .bind(status, status, at, status, at, id)
    .run();
}

/** 更新 last_used_at(服务层限频调用)。 */
export async function touchLastUsed(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).bind(at, id).run();
}

export async function countApiKeysByStatus(db: D1Database): Promise<Record<string, number>> {
  const res = await db.prepare(`SELECT status, COUNT(*) AS n FROM api_keys GROUP BY status`).all();
  const out: Record<string, number> = {};
  for (const r of res.results ?? []) out[r.status as string] = Number(r.n);
  return out;
}
