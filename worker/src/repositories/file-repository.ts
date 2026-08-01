/**
 * files 表仓储。所有公开下载授权都必须通过「条件更新 + RETURNING」原子领取,
 * 禁止先查询再更新(§16.2 / §16.3)。
 */

export type FileStatus = 'uploading' | 'ready' | 'consumed' | 'expired' | 'deleted' | 'failed';
export type FileSource = 'agent_upload' | 'inbox_upload';

export interface FileRow {
  id: string;
  owner_key_id: string;
  source: FileSource;
  object_key: string;
  original_name: string;
  content_type: string | null;
  size_bytes: number;
  sha256: string | null;
  public_token_hash: string | null;
  status: FileStatus;
  created_at: number;
  ready_at: number | null;
  expires_at: number;
  consumed_at: number | null;
  expired_at: number | null;
  deleted_at: number | null;
  max_downloads: number | null;
  download_count: number;
  failed_download_count: number;
  burn_after_read: number;
  first_download_at: number | null;
  last_download_at: number | null;
  bytes_served: number;
  inbox_id: string | null;
  failure_code: string | null;
  metadata_json: string;
  upload_expires_at: number | null;
  r2_deleted_at: number | null;
  upload_object_deleted_at: number | null;
}

export interface CreateFileInput {
  id: string;
  ownerKeyId: string;
  source: FileSource;
  objectKey: string;
  originalName: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string | null;
  publicTokenHash: string | null;
  status: FileStatus;
  createdAt: number;
  expiresAt: number;
  maxDownloads: number | null;
  burnAfterRead: boolean;
  inboxId?: string | null;
  metadata?: Record<string, unknown>;
  uploadExpiresAt?: number | null;
}

const SELECT_COLUMNS = `
  id, owner_key_id, source, object_key, original_name, content_type,
  size_bytes, sha256, public_token_hash, status,
  created_at, ready_at, expires_at, consumed_at, expired_at, deleted_at,
  max_downloads, download_count, failed_download_count, burn_after_read,
  first_download_at, last_download_at, bytes_served,
  inbox_id, failure_code, metadata_json, upload_expires_at, r2_deleted_at,
  upload_object_deleted_at
`;

function mapRow(r: any): FileRow {
  return r as FileRow;
}

export async function createFile(db: D1Database, input: CreateFileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO files (
        id, owner_key_id, source, object_key, original_name, content_type,
        size_bytes, sha256, public_token_hash, status,
        created_at, ready_at, expires_at,
        max_downloads, burn_after_read, inbox_id, metadata_json, upload_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.ownerKeyId,
      input.source,
      input.objectKey,
      input.originalName,
      input.contentType,
      input.sizeBytes,
      input.sha256,
      input.publicTokenHash,
      input.status,
      input.createdAt,
      null,
      input.expiresAt,
      input.maxDownloads,
      input.burnAfterRead ? 1 : 0,
      input.inboxId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.uploadExpiresAt ?? null,
    )
    .run();
}

export async function getFileById(db: D1Database, id: string): Promise<FileRow | null> {
  const res = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM files WHERE id = ?`).bind(id).first();
  return res ? mapRow(res) : null;
}

export async function getFileByIdAndOwner(
  db: D1Database,
  id: string,
  ownerKeyId: string,
): Promise<FileRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM files WHERE id = ? AND owner_key_id = ?`)
    .bind(id, ownerKeyId)
    .first();
  return res ? mapRow(res) : null;
}

export async function getFileByTokenHash(db: D1Database, tokenHash: string): Promise<FileRow | null> {
  const res = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM files WHERE public_token_hash = ? LIMIT 1`)
    .bind(tokenHash)
    .first();
  return res ? mapRow(res) : null;
}

/** 将文件标记为 ready。 */
export async function markFileReady(
  db: D1Database,
  id: string,
  readyAt: number,
  sha256: string | null,
): Promise<FileRow | null> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'ready', ready_at = ?, sha256 = ?
       WHERE id = ? AND status = 'uploading'
       RETURNING ${SELECT_COLUMNS}`,
    )
    .bind(readyAt, sha256, id)
    .first();
  return res ? mapRow(res) : null;
}

/** 标记上传失败。ready 仅用于 Inbox 租约丢失后的补偿。 */
export async function markFileFailed(
  db: D1Database,
  id: string,
  failureCode: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE files SET status = 'failed', failure_code = ?
       WHERE id = ? AND status IN ('uploading', 'ready')`,
    )
    .bind(failureCode, id)
    .run();
}

/**
 * §16.2 普通下载:条件更新领取一次下载额度。
 * 仅当 token 有效、文件 ready、未过期、非阅后即焚且次数未耗尽时成功。
 */
export async function claimDownload(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<FileRow | null> {
  const res = await db
    .prepare(
      `UPDATE files
       SET download_count = download_count + 1,
           first_download_at = COALESCE(first_download_at, ?),
           last_download_at = ?,
           bytes_served = bytes_served + size_bytes
       WHERE public_token_hash = ?
         AND status = 'ready'
         AND expires_at > ?
         AND burn_after_read = 0
         AND (max_downloads IS NULL OR download_count < max_downloads)
       RETURNING ${SELECT_COLUMNS}`,
    )
    .bind(now, now, tokenHash, now)
    .first();
  return res ? mapRow(res) : null;
}

/**
 * §16.3 阅后即焚:原子领取。第一个成功的请求独占;后续无法匹配 status='ready'。
 */
export async function claimBurnAfterRead(
  db: D1Database,
  tokenHash: string,
  now: number,
): Promise<FileRow | null> {
  const res = await db
    .prepare(
      `UPDATE files
       SET status = 'consumed',
           consumed_at = ?,
           download_count = download_count + 1,
           first_download_at = COALESCE(first_download_at, ?),
           last_download_at = ?,
           bytes_served = bytes_served + size_bytes
       WHERE public_token_hash = ?
         AND status = 'ready'
         AND expires_at > ?
         AND burn_after_read = 1
       RETURNING ${SELECT_COLUMNS}`,
    )
    .bind(now, now, now, tokenHash, now)
    .first();
  return res ? mapRow(res) : null;
}

/**
 * 私有下载:只允许 status='ready'(§17 推荐安全语义)。
 * consumed/expired/deleted/failed 一律拒绝。
 */
export async function getFileForPrivateDownload(
  db: D1Database,
  id: string,
  ownerKeyId: string,
): Promise<FileRow | null> {
  const res = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM files
       WHERE id = ? AND owner_key_id = ? AND status = 'ready'`,
    )
    .bind(id, ownerKeyId)
    .first();
  return res ? mapRow(res) : null;
}

/** 软删除:幂等。重复删除返回 false(未变更)。 */
export async function softDeleteFile(
  db: D1Database,
  id: string,
  ownerKeyId: string | null,
  at: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'deleted', deleted_at = ?
       WHERE id = ? AND (? IS NULL OR owner_key_id = ?) AND status != 'deleted'
       RETURNING id`,
    )
    .bind(at, id, ownerKeyId, ownerKeyId)
    .first();
  return res != null;
}

/** Root 删除任意文件。 */
export async function softDeleteFileAnyOwner(db: D1Database, id: string, at: number): Promise<boolean> {
  return softDeleteFile(db, id, null, at);
}

export interface FileListOptions {
  ownerKeyId?: string;
  status?: FileStatus;
  source?: FileSource;
  createdFrom?: number;
  createdTo?: number;
  filename?: string;
  cursor?: string;
  limit: number;
}

export interface FileListResult {
  rows: FileRow[];
  nextCursor: string | null;
}

/**
 * 游标分页,按 created_at DESC, id DESC。
 * 必须强制 owner_key_id = 认证租户(普通 API);Root 可不传 ownerKeyId。
 */
export async function listFiles(
  db: D1Database,
  opts: FileListOptions,
): Promise<FileListResult> {
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
  if (opts.source) {
    conditions.push('source = ?');
    binds.push(opts.source);
  }
  if (opts.createdFrom != null) {
    conditions.push('created_at >= ?');
    binds.push(opts.createdFrom);
  }
  if (opts.createdTo != null) {
    conditions.push('created_at <= ?');
    binds.push(opts.createdTo);
  }
  if (opts.filename != null) {
    conditions.push('original_name = ?');
    binds.push(opts.filename);
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
    sql = `SELECT ${SELECT_COLUMNS} FROM files ${where}
           AND (created_at, id) < (?, ?)
           ORDER BY created_at DESC, id DESC LIMIT ?`;
    binds.push(cursorCreatedAt, cursorId, limit + 1);
  } else {
    sql = `SELECT ${SELECT_COLUMNS} FROM files ${where}
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

/** 公开下载已授权但 R2 对象缺失时,记录失败下载次数(§27.1)。 */
export async function incrementFailedDownload(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(`UPDATE files SET failed_download_count = failed_download_count + 1 WHERE id = ?`)
    .bind(id)
    .run();
}

/** 清理:把到期的 ready 文件标记为 expired。返回受影响数量。 */
export async function markExpiredFiles(
  db: D1Database,
  now: number,
  batchLimit: number,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'expired', expired_at = ?
       WHERE id IN (
         SELECT id FROM files
         WHERE status = 'ready' AND expires_at <= ?
         ORDER BY id LIMIT ?
       )
       RETURNING id`,
    )
    .bind(now, now, batchLimit)
    .all();
  return (res.results ?? []).length;
}

/** 清理:下载次数耗尽的 ready 文件转为 consumed(元数据保留,供审计)。 */
export async function markExhaustedDownloadsConsumed(
  db: D1Database,
  now: number,
  batchLimit: number,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'consumed', consumed_at = ?
       WHERE id IN (
         SELECT id FROM files
         WHERE status = 'ready' AND burn_after_read = 0
           AND max_downloads IS NOT NULL AND download_count >= max_downloads
         ORDER BY id LIMIT ?
       )
       RETURNING id`,
    )
    .bind(now, batchLimit)
    .all();
  return (res.results ?? []).length;
}

/** 清理:超时的 uploading 文件标记为 failed。 */
export async function markStaleUploadingFailed(
  db: D1Database,
  now: number,
  before: number,
  batchLimit: number,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'failed', failure_code = 'upload_timeout'
       WHERE id IN (
         SELECT id FROM files
         WHERE status = 'uploading'
           AND (
             (upload_expires_at IS NOT NULL AND upload_expires_at <= ?)
             OR (upload_expires_at IS NULL AND created_at < ?)
           )
         ORDER BY id LIMIT ?
       )
       RETURNING id`,
    )
    .bind(now, before, batchLimit)
    .all();
  return (res.results ?? []).length;
}

export interface CleanupObject {
  id: string;
  objectKey: string;
}

/** 返回尚未完成物理删除的对象。failed 必须等签名上传 URL 过期后再删。 */
export async function listCleanupObjectKeys(
  db: D1Database,
  now: number,
  limit: number,
): Promise<CleanupObject[]> {
  const res = await db
    .prepare(
      `SELECT id, object_key FROM files
       WHERE r2_deleted_at IS NULL
         AND (
           status IN ('consumed', 'expired', 'deleted')
           OR (status = 'failed' AND (upload_expires_at IS NULL OR upload_expires_at <= ?))
         )
       ORDER BY id
       LIMIT ?`,
    )
    .bind(now, limit)
    .all();
  return (res.results ?? []).map((r: any) => ({ id: r.id as string, objectKey: r.object_key as string }));
}

export async function markObjectDeleted(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare(`UPDATE files SET r2_deleted_at = ? WHERE id = ?`).bind(at, id).run();
}

/** 直传 URL 过期后清理暂存 Key；包括已 ready 的文件，防止旧 URL 留下可变副本。 */
export async function listExpiredUploadObjectKeys(
  db: D1Database,
  now: number,
  limit: number,
): Promise<CleanupObject[]> {
  const res = await db
    .prepare(
      `SELECT id, object_key FROM files
       WHERE upload_expires_at IS NOT NULL
         AND upload_expires_at <= ?
         AND upload_object_deleted_at IS NULL
       ORDER BY id LIMIT ?`,
    )
    .bind(now, limit)
    .all();
  return (res.results ?? []).map((r: any) => ({ id: r.id as string, objectKey: r.object_key as string }));
}

export async function markUploadObjectDeleted(db: D1Database, id: string, at: number): Promise<void> {
  await db.prepare(`UPDATE files SET upload_object_deleted_at = ? WHERE id = ?`).bind(at, id).run();
}

/** 新租约领取后使同一 Inbox 的旧直传会话失效。 */
export async function failUploadingFilesForInbox(
  db: D1Database,
  inboxId: string,
  failureCode: string,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE files SET status = 'failed', failure_code = ?
       WHERE inbox_id = ? AND status = 'uploading'
       RETURNING id`,
    )
    .bind(failureCode, inboxId)
    .all();
  return (res.results ?? []).length;
}

export async function getFileForInboxOwnerDownload(
  db: D1Database,
  inboxId: string,
  ownerKeyId: string,
): Promise<FileRow | null> {
  const res = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM files
       WHERE inbox_id = ? AND owner_key_id = ? AND status = 'ready'
       LIMIT 1`,
    )
    .bind(inboxId, ownerKeyId)
    .first();
  return res ? mapRow(res) : null;
}

export async function countFilesByStatus(
  db: D1Database,
  ownerKeyId?: string,
): Promise<Record<string, number>> {
  const where = ownerKeyId ? 'WHERE owner_key_id = ?' : '';
  const binds = ownerKeyId ? [ownerKeyId] : [];
  const res = await db.prepare(`SELECT status, COUNT(*) AS n FROM files ${where} GROUP BY status`).bind(...binds).all();
  const out: Record<string, number> = {};
  for (const r of res.results ?? []) out[r.status as string] = Number(r.n);
  return out;
}

/** §9.1 配额:活跃文件数(ready + uploading)。 */
export async function countActiveFiles(
  db: D1Database,
  ownerKeyId: string,
): Promise<number> {
  const res = await db
    .prepare(`SELECT COUNT(*) AS n FROM files WHERE owner_key_id = ? AND status IN ('ready', 'uploading')`)
    .bind(ownerKeyId)
    .first();
  return Number((res as any)?.n ?? 0);
}

/** §9.1 配额:活跃存储字节(ready + uploading)。 */
export async function sumActiveStorageBytes(
  db: D1Database,
  ownerKeyId: string,
): Promise<number> {
  const res = await db
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE owner_key_id = ? AND status IN ('ready', 'uploading')`)
    .bind(ownerKeyId)
    .first();
  return Number((res as any)?.total ?? 0);
}

export async function sumStorageBytes(
  db: D1Database,
  ownerKeyId?: string,
): Promise<number> {
  const where = ownerKeyId ? 'WHERE owner_key_id = ? AND status IN (?, ?)' : 'WHERE status IN (?, ?)';
  const binds = ownerKeyId ? [ownerKeyId, 'ready', 'consumed'] : ['ready', 'consumed'];
  const res = await db
    .prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files ${where}`)
    .bind(...binds)
    .first();
  return Number((res as any)?.total ?? 0);
}
