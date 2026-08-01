/**
 * upload_inboxes 表仓储。一次性上传使用带租约的状态机(§20):
 * open -> uploading -> completed / open / expired / revoked。
 */

export type InboxStatus = 'open' | 'uploading' | 'completed' | 'expired' | 'revoked';

export interface InboxRow {
  id: string;
  owner_key_id: string;
  public_token_hash: string;
  title: string | null;
  description: string | null;
  status: InboxStatus;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
  revoked_at: number | null;
  max_file_size_bytes: number;
  allowed_extensions_json: string;
  allowed_content_types_json: string;
  expected_filename: string | null;
  upload_lease_id: string | null;
  upload_lease_started_at: number | null;
  upload_lease_until: number | null;
  received_file_id: string | null;
  metadata_json: string;
}

export interface CreateInboxInput {
  id: string;
  ownerKeyId: string;
  publicTokenHash: string;
  title: string | null;
  description: string | null;
  createdAt: number;
  expiresAt: number;
  maxFileSizeBytes: number;
  allowedExtensions: string[];
  allowedContentTypes: string[];
  expectedFilename: string | null;
  metadata?: Record<string, unknown>;
}

const SELECT_COLUMNS = `
  id, owner_key_id, public_token_hash, title, description, status,
  created_at, expires_at, completed_at, revoked_at,
  max_file_size_bytes, allowed_extensions_json, allowed_content_types_json,
  expected_filename, upload_lease_id, upload_lease_started_at, upload_lease_until,
  received_file_id, metadata_json
`;

function mapRow(r: any): InboxRow {
  return r as InboxRow;
}

export async function createInbox(db: D1Database, input: CreateInboxInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO upload_inboxes (
        id, owner_key_id, public_token_hash, title, description, status,
        created_at, expires_at,
        max_file_size_bytes, allowed_extensions_json, allowed_content_types_json,
        expected_filename, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.ownerKeyId,
      input.publicTokenHash,
      input.title,
      input.description,
      input.createdAt,
      input.expiresAt,
      input.maxFileSizeBytes,
      JSON.stringify(input.allowedExtensions),
      JSON.stringify(input.allowedContentTypes),
      input.expectedFilename,
      JSON.stringify(input.metadata ?? {}),
    )
    .run();
}

export async function getInboxById(db: D1Database, id: string): Promise<InboxRow | null> {
  const res = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM upload_inboxes WHERE id = ?`).bind(id).first();
  return res ? mapRow(res) : null;
}

export async function getInboxByIdAndOwner(
  db: D1Database,
  id: string,
  ownerKeyId: string,
): Promise<InboxRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM upload_inboxes WHERE id = ? AND owner_key_id = ?`)
    .bind(id, ownerKeyId)
    .first();
  return res ? mapRow(res) : null;
}

export async function getInboxByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<InboxRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM upload_inboxes WHERE public_token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first();
  return res ? mapRow(res) : null;
}

/**
 * §20.1 原子领取上传租约。
 * 仅当邀请未过期,且状态为 open,或 uploading 且租约已过期时成功。
 */
export async function claimInboxLease(
  db: D1Database,
  tokenHash: string,
  leaseId: string,
  now: number,
  leaseUntil: number,
): Promise<InboxRow | null> {
  const res = await db
    .prepare(
      `UPDATE upload_inboxes
       SET status = 'uploading',
           upload_lease_id = ?,
           upload_lease_started_at = ?,
           upload_lease_until = ?
       WHERE public_token_hash = ?
         AND expires_at > ?
         AND (
             status = 'open'
             OR (status = 'uploading' AND upload_lease_until < ?)
         )
       RETURNING ${SELECT_COLUMNS}`,
    )
    .bind(leaseId, now, leaseUntil, tokenHash, now, now)
    .first();
  return res ? mapRow(res) : null;
}

/**
 * §20.2 上传成功后原子完成 Inbox。
 * 必须匹配 lease_id,防止旧租约完成新上传。
 */
export async function completeInboxUpload(
  db: D1Database,
  id: string,
  leaseId: string,
  fileId: string,
  now: number,
): Promise<InboxRow | null> {
  const res = await db
    .prepare(
      `UPDATE upload_inboxes
       SET status = 'completed',
           completed_at = ?,
           received_file_id = ?,
           upload_lease_id = NULL,
           upload_lease_started_at = NULL,
           upload_lease_until = NULL
       WHERE id = ? AND status = 'uploading' AND upload_lease_id = ?
       RETURNING ${SELECT_COLUMNS}`,
    )
    .bind(now, fileId, id, leaseId)
    .first();
  return res ? mapRow(res) : null;
}

/**
 * §20.3 上传失败释放租约:邀请未过期则回到 open,已过期则置为 expired。
 * 必须匹配 lease_id。
 */
export async function releaseInboxLease(
  db: D1Database,
  id: string,
  leaseId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE upload_inboxes
       SET status = CASE WHEN expires_at > ? THEN 'open' ELSE 'expired' END,
           upload_lease_id = NULL,
           upload_lease_started_at = NULL,
           upload_lease_until = NULL
       WHERE id = ? AND status = 'uploading' AND upload_lease_id = ?`,
    )
    .bind(now, id, leaseId)
    .run();
}

export interface InboxListOptions {
  ownerKeyId?: string;
  status?: InboxStatus;
  cursor?: string;
  limit: number;
}

export interface InboxListResult {
  rows: InboxRow[];
  nextCursor: string | null;
}

export async function listInboxes(
  db: D1Database,
  opts: InboxListOptions,
): Promise<InboxListResult> {
  const limit = opts.limit;
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (opts.ownerKeyId) {
    conditions.push('owner_key_id = ?');
    binds.push(opts.ownerKeyId);
  }
  if (opts.status) {
    conditions.push('status = ?');
    binds.push(opts.status);
  }

  let cursorCreatedAt: number | null = null;
  let cursorId: string | null = null;
  if (opts.cursor) {
    const parts = opts.cursor.split(':');
    if (parts.length === 2) {
      cursorCreatedAt = Number(parts[0]);
      cursorId = parts[1]!;
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let sql: string;
  if (cursorCreatedAt != null && cursorId != null) {
    sql = `SELECT ${SELECT_COLUMNS} FROM upload_inboxes ${where}
           AND (created_at, id) < (?, ?)
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    binds.push(cursorCreatedAt, cursorId, limit + 1);
  } else {
    sql = `SELECT ${SELECT_COLUMNS} FROM upload_inboxes ${where}
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    binds.push(limit + 1);
  }

  const res = await db.prepare(sql).bind(...binds).all();
  const list = (res.results ?? []).map(mapRow);
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}:${last.id}` : null;
  return { rows: page, nextCursor };
}

/** 软撤销:open/uploading -> revoked(幂等)。 */
export async function revokeInbox(
  db: D1Database,
  id: string,
  ownerKeyId: string | null,
  at: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE upload_inboxes
       SET status = 'revoked', revoked_at = ?,
           upload_lease_id = NULL, upload_lease_started_at = NULL, upload_lease_until = NULL
       WHERE id = ? AND (? IS NULL OR owner_key_id = ?) AND status IN ('open', 'uploading')
       RETURNING id`,
    )
    .bind(at, id, ownerKeyId, ownerKeyId)
    .first();
  return res != null;
}

/** 撤销某租户所有未完成 Inbox(key 吊销策略 revoke_inboxes / revoke_all)。 */
export async function revokeInboxesByOwner(
  db: D1Database,
  ownerKeyId: string,
  at: number,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE upload_inboxes
       SET status = 'revoked', revoked_at = ?,
           upload_lease_id = NULL, upload_lease_started_at = NULL, upload_lease_until = NULL
       WHERE owner_key_id = ? AND status IN ('open', 'uploading')
       RETURNING id`,
    )
    .bind(at, ownerKeyId)
    .all();
  return (res.results ?? []).length;
}

/** 清理:到期的 open/uploading Inbox -> expired。 */
export async function markExpiredInboxes(
  db: D1Database,
  now: number,
  batchLimit: number,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE upload_inboxes SET status = 'expired',
         upload_lease_id = NULL, upload_lease_started_at = NULL, upload_lease_until = NULL
       WHERE id IN (
         SELECT id FROM upload_inboxes
         WHERE status IN ('open', 'uploading') AND expires_at <= ?
         ORDER BY id LIMIT ?
       )
       RETURNING id`,
    )
    .bind(now, batchLimit)
    .all();
  return (res.results ?? []).length;
}

export async function countInboxesByStatus(
  db: D1Database,
  ownerKeyId?: string,
): Promise<Record<string, number>> {
  const where = ownerKeyId ? 'WHERE owner_key_id = ?' : '';
  const binds = ownerKeyId ? [ownerKeyId] : [];
  const res = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM upload_inboxes ${where} GROUP BY status`)
    .bind(...binds)
    .all();
  const out: Record<string, number> = {};
  for (const r of res.results ?? []) out[r.status as string] = Number(r.n);
  return out;
}
