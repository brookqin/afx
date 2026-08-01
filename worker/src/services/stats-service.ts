/**
 * 统计服务(§27)。首版实时聚合,不维护 daily_stats 表。
 */

import type { Env } from '../env';
import * as fileRepo from '../repositories/file-repository';
import * as inboxRepo from '../repositories/inbox-repository';
import * as keyRepo from '../repositories/api-key-repository';

export interface TenantStats {
  files_total: number;
  files_ready: number;
  files_expired: number;
  files_consumed: number;
  files_deleted: number;
  files_failed: number;
  files_uploading: number;
  storage_bytes: number;
  agent_uploads: number;
  inbox_uploads: number;
  inboxes_total: number;
  inboxes_open: number;
  inboxes_completed: number;
  inboxes_expired: number;
  public_downloads_authorized: number;
  bytes_served_authorized: number;
  failed_downloads: number;
}

export class StatsService {
  constructor(private readonly env: Env) {}

  async tenantStats(ownerKeyId: string): Promise<TenantStats> {
    const [files, inboxes, downloadStats, sourceCounts] = await Promise.all([
      fileRepo.countFilesByStatus(this.env.DB, ownerKeyId),
      inboxRepo.countInboxesByStatus(this.env.DB, ownerKeyId),
      this.downloadAggregates(ownerKeyId),
      this.countSources(ownerKeyId),
    ]);

    return {
      files_total: total(files),
      files_ready: files.ready ?? 0,
      files_expired: files.expired ?? 0,
      files_consumed: files.consumed ?? 0,
      files_deleted: files.deleted ?? 0,
      files_failed: files.failed ?? 0,
      files_uploading: files.uploading ?? 0,
      storage_bytes: await fileRepo.sumStorageBytes(this.env.DB, ownerKeyId),
      agent_uploads: sourceCounts.agent_upload,
      inbox_uploads: sourceCounts.inbox_upload,
      inboxes_total: total(inboxes),
      inboxes_open: inboxes.open ?? 0,
      inboxes_completed: inboxes.completed ?? 0,
      inboxes_expired: inboxes.expired ?? 0,
      public_downloads_authorized: downloadStats.downloads,
      bytes_served_authorized: downloadStats.bytes,
      failed_downloads: downloadStats.failed,
    };
  }

  async rootStats(): Promise<Record<string, unknown>> {
    const [keys, files, inboxes, downloadStats] = await Promise.all([
      keyRepo.countApiKeysByStatus(this.env.DB),
      fileRepo.countFilesByStatus(this.env.DB),
      inboxRepo.countInboxesByStatus(this.env.DB),
      this.downloadAggregates(),
    ]);

    return {
      api_keys: keys,
      files: files,
      files_total: total(files),
      storage_bytes: await fileRepo.sumStorageBytes(this.env.DB),
      inboxes: inboxes,
      inboxes_total: total(inboxes),
      public_downloads_authorized: downloadStats.downloads,
      bytes_served_authorized: downloadStats.bytes,
      failed_downloads: downloadStats.failed,
    };
  }

  private async downloadAggregates(ownerKeyId?: string): Promise<{ downloads: number; bytes: number; failed: number }> {
    const where = ownerKeyId ? 'WHERE owner_key_id = ?' : '';
    const binds = ownerKeyId ? [ownerKeyId] : [];
    const res = await this.env.DB
      .prepare(
        `SELECT
           COALESCE(SUM(download_count), 0) AS downloads,
           COALESCE(SUM(bytes_served), 0) AS bytes,
           COALESCE(SUM(failed_download_count), 0) AS failed
         FROM files ${where}`,
      )
      .bind(...binds)
      .first();
    return {
      downloads: Number((res as any)?.downloads ?? 0),
      bytes: Number((res as any)?.bytes ?? 0),
      failed: Number((res as any)?.failed ?? 0),
    };
  }

  private async countSources(ownerKeyId: string): Promise<{ agent_upload: number; inbox_upload: number }> {
    const res = await this.env.DB
      .prepare(`SELECT source, COUNT(*) AS n FROM files WHERE owner_key_id = ? GROUP BY source`)
      .bind(ownerKeyId)
      .all();
    const out = { agent_upload: 0, inbox_upload: 0 };
    for (const r of res.results ?? []) {
      const src = r.source as string;
      if (src === 'agent_upload') out.agent_upload = Number(r.n);
      if (src === 'inbox_upload') out.inbox_upload = Number(r.n);
    }
    return out;
  }
}

function total(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0);
}
