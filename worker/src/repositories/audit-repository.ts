/**
 * audit_events 表仓储。审计绝不记录完整 Token / API Key / 文件正文。
 * metadata 必须经过字段白名单(见 audit-service)。
 */

export type ActorType = 'root_key' | 'api_key' | 'public_download' | 'public_upload' | 'system';
export type AuditResult = 'success' | 'denied' | 'failed';

export interface AuditEventInput {
  ownerKeyId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: AuditResult;
  requestId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface AuditRow extends Omit<AuditEventInput, 'metadata'> {
  id: number;
  metadata: Record<string, unknown>;
}

export async function insertAuditEvent(db: D1Database, ev: AuditEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events (
        owner_key_id, actor_type, actor_id, action, resource_type, resource_id,
        result, request_id, ip_hash, user_agent, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ev.ownerKeyId ?? null,
      ev.actorType,
      ev.actorId ?? null,
      ev.action,
      ev.resourceType ?? null,
      ev.resourceId ?? null,
      ev.result,
      ev.requestId ?? null,
      ev.ipHash ?? null,
      ev.userAgent ? ev.userAgent.slice(0, 512) : null,
      JSON.stringify(ev.metadata ?? {}),
      ev.createdAt,
    )
    .run();
}

export interface AuditListOptions {
  ownerKeyId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  cursor?: number; // audit id 单调递增,直接作为游标
  limit: number;
}

export interface AuditListResult {
  rows: AuditRow[];
  nextCursor: number | null;
}

export async function listAuditEvents(
  db: D1Database,
  opts: AuditListOptions,
): Promise<AuditListResult> {
  const limit = opts.limit;
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (opts.ownerKeyId) {
    conditions.push('owner_key_id = ?');
    binds.push(opts.ownerKeyId);
  }
  if (opts.action) {
    conditions.push('action = ?');
    binds.push(opts.action);
  }
  if (opts.resourceType) {
    conditions.push('resource_type = ?');
    binds.push(opts.resourceType);
  }
  if (opts.resourceId) {
    conditions.push('resource_id = ?');
    binds.push(opts.resourceId);
  }
  if (opts.cursor != null) {
    conditions.push('id < ?');
    binds.push(opts.cursor);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ?`;
  binds.push(limit + 1);

  const res = await db.prepare(sql).bind(...binds).all();
  const list = (res.results ?? []).map((r: any) => ({
    ...r,
    metadata: safeParseJson(r.metadata_json ?? '{}'),
  }));
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? last.id : null;
  return { rows: page, nextCursor };
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
