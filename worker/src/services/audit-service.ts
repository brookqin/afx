/**
 * 审计服务。所有审计事件经此写入:
 * - metadata 仅允许白名单字段,且只接受原始类型。
 * - 绝不写入完整 Token / API Key / Secret / 文件正文。
 */

import type { Env } from '../env';
import {
  insertAuditEvent,
  listAuditEvents,
  type ActorType,
  type AuditResult,
  type AuditRow,
} from '../repositories/audit-repository';

const ALLOWED_METADATA_KEYS = new Set([
  'filename',
  'file_id',
  'size_bytes',
  'content_type',
  'expires_in',
  'max_downloads',
  'burn_after_read',
  'old_status',
  'status',
  'reason',
  'download_count',
  'max_file_size_bytes',
  'allowed_extensions',
  'bytes',
  'count',
  'scope',
  'resource_policy',
  'object_key_hash',
  'fields',
  'direct_upload',
  'expired_files',
  'expired_inboxes',
  'consumed',
  'failed_uploads',
  'deleted_objects',
  'deleted_upload_objects',
]);

export interface AuditEventParams {
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
}

export class AuditService {
  constructor(private readonly env: Env) {}

  private sanitize(metadata?: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!metadata) return out;
    for (const [k, v] of Object.entries(metadata)) {
      if (!ALLOWED_METADATA_KEYS.has(k)) continue;
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean' || v === null) {
        out[k] = v;
      }
    }
    return out;
  }

  /** 记录事件;失败不抛出,仅记录日志(审计不应阻断主流程)。 */
  async record(params: AuditEventParams): Promise<void> {
    try {
      await insertAuditEvent(this.env.DB, {
        ownerKeyId: params.ownerKeyId ?? null,
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        action: params.action,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        result: params.result,
        requestId: params.requestId ?? null,
        ipHash: params.ipHash ?? null,
        userAgent: params.userAgent ?? null,
        metadata: this.sanitize(params.metadata),
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error('[audit] failed to record event:', err);
    }
  }

  async list(
    ownerKeyId: string | undefined,
    opts: { action?: string; resourceType?: string; resourceId?: string; cursor?: number; limit: number },
  ): Promise<{ rows: AuditRow[]; nextCursor: number | null }> {
    return listAuditEvents(this.env.DB, { ownerKeyId, ...opts });
  }
}
