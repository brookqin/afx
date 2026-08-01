/**
 * 定时清理服务(§25)。由 Workers Cron Trigger 每小时触发。
 * 分页批量处理,避免单次执行超时:
 * 1. 到期 ready 文件 -> expired
 * 2. 到期 open/uploading Inbox -> expired
 * 3. 下载次数耗尽的 ready 文件 -> consumed
 * 4. 超时 uploading 文件 -> failed
 * 5. 清理过期直传暂存对象与 consumed/expired/deleted 最终对象
 */

import type { Env } from '../env';
import * as fileRepo from '../repositories/file-repository';
import * as inboxRepo from '../repositories/inbox-repository';
import type { AuditService } from './audit-service';
import { stagingObjectKey } from './direct-upload-service';

const BATCH_LIMIT = 200;
const MAX_ROUNDS = 50;

export class CleanupService {
  constructor(
    private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async run(): Promise<{
    expiredFiles: number;
    expiredInboxes: number;
    consumed: number;
    failedUploads: number;
    deletedObjects: number;
    deletedUploadObjects: number;
  }> {
    const now = Date.now();
    const staleBefore = now - 2 * 60 * 60 * 1000; // uploading 超过 2 小时视为超时

    let expiredFiles = 0;
    let expiredInboxes = 0;
    let consumed = 0;
    let failedUploads = 0;
    let deletedObjects = 0;
    let deletedUploadObjects = 0;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const n = await fileRepo.markExpiredFiles(this.env.DB, now, BATCH_LIMIT);
      expiredFiles += n;
      if (n < BATCH_LIMIT) break;
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const n = await inboxRepo.markExpiredInboxes(this.env.DB, now, BATCH_LIMIT);
      expiredInboxes += n;
      if (n < BATCH_LIMIT) break;
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const n = await fileRepo.markExhaustedDownloadsConsumed(this.env.DB, now, BATCH_LIMIT);
      consumed += n;
      if (n < BATCH_LIMIT) break;
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const n = await fileRepo.markStaleUploadingFailed(this.env.DB, now, staleBefore, BATCH_LIMIT);
      failedUploads += n;
      if (n < BATCH_LIMIT) break;
    }

    // presigned URL 过期后清理暂存对象。ready 行也必须处理，旧 URL 在过期前可重复使用。
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const objects = await fileRepo.listExpiredUploadObjectKeys(this.env.DB, now, BATCH_LIMIT);
      if (objects.length === 0) break;
      for (const object of objects) {
        try {
          await this.env.FILES.delete(stagingObjectKey(object.objectKey));
          await fileRepo.markUploadObjectDeleted(this.env.DB, object.id, now);
          deletedUploadObjects++;
        } catch {
          // 保留未标记状态，下次 Cron 重试。
        }
      }
      if (objects.length < BATCH_LIMIT) break;
    }

    // 物理清理已终态文件的最终 R2 对象
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const objects = await fileRepo.listCleanupObjectKeys(this.env.DB, now, BATCH_LIMIT);
      if (objects.length === 0) break;
      let failures = 0;
      for (const object of objects) {
        try {
          await this.env.FILES.delete(object.objectKey);
          await fileRepo.markObjectDeleted(this.env.DB, object.id, now);
          deletedObjects++;
        } catch {
          failures++;
        }
      }
      if (failures > 0) {
        await this.audit.record({
          ownerKeyId: null,
          actorType: 'system',
          action: 'file.cleanup_failed',
          resourceType: 'r2_object',
          result: 'failed',
          metadata: { count: failures },
        });
      }
      if (objects.length < BATCH_LIMIT) break;
    }

    await this.audit.record({
      ownerKeyId: null,
      actorType: 'system',
      action: 'cleanup.run_completed',
      result: 'success',
      metadata: {
        expired_files: expiredFiles,
        expired_inboxes: expiredInboxes,
        consumed,
        failed_uploads: failedUploads,
        deleted_objects: deletedObjects,
        deleted_upload_objects: deletedUploadObjects,
      },
    });

    return { expiredFiles, expiredInboxes, consumed, failedUploads, deletedObjects, deletedUploadObjects };
  }
}
