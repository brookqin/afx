/**
 * 文件服务:上传、公开下载(原子领取)、私有下载、删除、列表、统计。
 *
 * 并发语义(§3.5 / §16):
 * - 公开下载权通过 D1 条件更新 + RETURNING 原子领取,禁止先查后改。
 * - 阅后即焚:第一个获得下载权的请求把文件置为 consumed,传输中断也算已消耗。
 * - 私有下载不消耗公开次数、不触发阅后即焚。
 */

import type { Env } from '../env';
import {
  downloadLimitReached,
  fileConsumed,
  fileDeleted,
  fileExpired,
  fileNotFound,
  fileNotReady,
  fileTooLarge,
  fileUploadFailed,
  invalidRequest,
  invalidToken,
  quotaExceeded,
  uploadedObjectMismatch,
  uploadNotComplete,
  uploadSessionExpired,
  ApiError,
} from '../errors';
import * as fileRepo from '../repositories/file-repository';
import type { FileRow } from '../repositories/file-repository';
import { attachmentContentDisposition } from '../security/content-disposition';
import { cleanFilename } from '../security/filename';
import { generateToken, tokenHash } from '../security/token';
import { ulid } from '../util/id';
import { clampExpireSeconds, isExpired, nowMs } from '../util/time';
import type { AuditService } from './audit-service';
import {
  directUploadLifetimeSeconds,
  normalizeUploadContentType,
  promoteDirectUpload,
  signDirectPut,
  stagingObjectKey,
  type DirectUploadTarget,
} from './direct-upload-service';

export interface InitiateUploadContext {
  ownerKeyId: string;
  actorId: string;
  maxFileSizeBytes: number;
  /** Key 策略:默认有效期与最大有效期(§15.1) */
  defaultExpireSeconds: number;
  maxExpireSeconds: number;
  /** Key 配额(best-effort 预检,§9.1) */
  maxStorageBytes?: number | null;
  maxActiveFiles?: number | null;
  expiresIn?: number;
  maxDownloads?: number | null;
  burnAfterRead: boolean;
  filename: string;
  contentType?: string | null;
  sizeBytes: number;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export interface InitiateUploadResult {
  file: FileRow;
  downloadUrl: string;
  upload: DirectUploadTarget;
}

function objectKey(ownerKeyId: string, fileId: string): string {
  const d = new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `objects/${ownerKeyId}/${yyyy}/${mm}/${fileId}`;
}

export class FileService {
  constructor(
    private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  /** 创建 D1 upload session 并签发短期 R2 PUT URL；文件正文不经过 Worker。 */
  async initiateUpload(ctx: InitiateUploadContext): Promise<InitiateUploadResult> {
    if (ctx.sizeBytes > ctx.maxFileSizeBytes) {
      throw fileTooLarge('File exceeds the maximum allowed size.', {
        max_size_bytes: ctx.maxFileSizeBytes,
      });
    }

    const cleanName = cleanFilename(ctx.filename || 'file.bin');
    if (!cleanName) throw invalidRequest('Invalid filename.');

    const now = nowMs();
    const fileId = ulid(now);

    // 生成公开下载 Token 并保存摘要
    const rawToken = generateToken();
    const tokenHashValue = await tokenHash(this.env.TOKEN_HASH_PEPPER, rawToken);
    const key = objectKey(ctx.ownerKeyId, fileId);
    const contentType = normalizeUploadContentType(ctx.contentType);

    const maxDownloads = ctx.burnAfterRead ? 1 : (ctx.maxDownloads ?? null);
    // §15.1:未传 expires_in 时使用 Key 默认值,且不得超过 Key 的最大值
    const expireSeconds = clampExpireSeconds(ctx.expiresIn, ctx.defaultExpireSeconds, ctx.maxExpireSeconds);

    // §9.1 quota best-effort 预检(并发下允许少量超限,不引入分布式锁)
    await this.checkQuota(ctx.ownerKeyId, ctx.sizeBytes, ctx.maxStorageBytes, ctx.maxActiveFiles);

    const uploadLifetime = directUploadLifetimeSeconds(this.env);
    const expiresAt = now + expireSeconds * 1000;
    const uploadExpiresAt = Math.min(expiresAt, now + uploadLifetime * 1000);
    const signedLifetime = Math.max(1, Math.floor((uploadExpiresAt - now) / 1000));

    await fileRepo.createFile(this.env.DB, {
      id: fileId,
      ownerKeyId: ctx.ownerKeyId,
      source: 'agent_upload',
      objectKey: key,
      originalName: cleanName,
      contentType,
      sizeBytes: ctx.sizeBytes,
      sha256: null,
      publicTokenHash: tokenHashValue,
      status: 'uploading',
      createdAt: now,
      expiresAt,
      maxDownloads,
      burnAfterRead: ctx.burnAfterRead,
      metadata: {},
      uploadExpiresAt,
    });

    await this.audit.record({
      ownerKeyId: ctx.ownerKeyId,
      actorType: 'api_key',
      actorId: ctx.actorId,
      action: 'file.upload_started',
      resourceType: 'file',
      resourceId: fileId,
      result: 'success',
      requestId: ctx.requestId,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
      metadata: { filename: cleanName, size_bytes: ctx.sizeBytes, direct_upload: true },
    });

    try {
      const upload = await signDirectPut(this.env, stagingObjectKey(key), contentType, signedLifetime);
      const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
      const file = await fileRepo.getFileById(this.env.DB, fileId);
      if (!file) throw new Error('file not found after create');
      return { file, downloadUrl: `${base}/d/${rawToken}`, upload };
    } catch {
      await fileRepo.markFileFailed(this.env.DB, fileId, 'signing_failed');
      await this.audit.record({
        ownerKeyId: ctx.ownerKeyId,
        actorType: 'api_key',
        actorId: ctx.actorId,
        action: 'file.upload_failed',
        resourceType: 'file',
        resourceId: fileId,
        result: 'failed',
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent,
        metadata: { reason: 'signing_failed' },
      });
      throw fileUploadFailed('Failed to create direct upload URL.');
    }
  }

  /** HEAD R2 object, verify declared metadata, then atomically publish it as ready. */
  async completeUpload(
    id: string,
    ownerKeyId: string,
    actor: { requestId: string; ipHash: string | null; userAgent: string | null; waitUntil?: (p: Promise<unknown>) => void },
  ): Promise<FileRow> {
    const file = await fileRepo.getFileByIdAndOwner(this.env.DB, id, ownerKeyId);
    if (!file) throw fileNotFound();
    if (file.status === 'ready') return file;
    if (file.status !== 'uploading') throw fileUploadFailed('Upload session is no longer active.');

    const now = nowMs();
    if (file.upload_expires_at != null && file.upload_expires_at <= now) {
      await fileRepo.markFileFailed(this.env.DB, file.id, 'upload_session_expired');
      throw uploadSessionExpired();
    }

    const uploadKey = stagingObjectKey(file.object_key);
    const object = await this.env.FILES.head(uploadKey);
    if (!object) throw uploadNotComplete();
    if (object.size !== file.size_bytes) {
      const cleanup = this.env.FILES.delete(uploadKey).catch(() => {});
      if (actor.waitUntil) actor.waitUntil(cleanup); else void cleanup;
      throw uploadedObjectMismatch(undefined, { expected_size_bytes: file.size_bytes, actual_size_bytes: object.size });
    }

    // 提升到不同的最终 Key，杜绝仍有效的 PUT URL 覆盖已发布对象。
    let published = await this.env.FILES.head(file.object_key);
    if (!published) {
      try {
        await promoteDirectUpload(this.env, uploadKey, file.object_key, normalizeUploadContentType(file.content_type));
      } catch (error) {
        // 并发完成时另一个请求可能已经成功 Copy；最终 HEAD 是事实来源。
        published = await this.env.FILES.head(file.object_key);
        if (!published) throw error;
      }
      published ??= await this.env.FILES.head(file.object_key);
    }
    if (!published || published.size !== file.size_bytes) {
      throw fileUploadFailed('Failed to verify the published object.');
    }

    const ready = await fileRepo.markFileReady(this.env.DB, file.id, now, null);
    if (!ready) {
      const current = await fileRepo.getFileByIdAndOwner(this.env.DB, file.id, ownerKeyId);
      if (current?.status === 'ready') return current;
      throw fileUploadFailed('Failed to finalize file metadata.');
    }

    await this.audit.record({
      ownerKeyId,
      actorType: 'api_key',
      actorId: ownerKeyId,
      action: 'file.upload_completed',
      resourceType: 'file',
      resourceId: file.id,
      result: 'success',
      requestId: actor.requestId,
      ipHash: actor.ipHash,
      userAgent: actor.userAgent,
      metadata: { filename: file.original_name, size_bytes: file.size_bytes, direct_upload: true },
    });
    return ready;
  }

  /**
   * §16 公开下载。返回 { file } 或 { error },R2 对象由调用方读取。
   */
  async publicDownload(
    rawToken: string,
    opts: { requestId: string; ipHash: string | null; userAgent: string | null },
  ): Promise<{ file: FileRow; burn: boolean } | { error: ApiError }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      return { error: invalidToken() };
    }
    const hash = await tokenHash(this.env.TOKEN_HASH_PEPPER, rawToken);
    const now = nowMs();

    const pre = await fileRepo.getFileByTokenHash(this.env.DB, hash);
    if (!pre) return { error: diagnosePublicFileError(pre, now) };
    if (pre.status !== 'ready') return { error: diagnosePublicFileError(pre, now) };
    if (isExpired(pre.expires_at, now)) return { error: diagnosePublicFileError(pre, now) };

    // 原子领取下载权
    const claimed =
      pre.burn_after_read === 1
        ? await fileRepo.claimBurnAfterRead(this.env.DB, hash, now)
        : await fileRepo.claimDownload(this.env.DB, hash, now);

    if (!claimed) {
      const after = await fileRepo.getFileByTokenHash(this.env.DB, hash);
      return { error: diagnosePublicFileError(after, now) };
    }

    await this.audit.record({
      ownerKeyId: claimed.owner_key_id,
      actorType: 'public_download',
      action: 'file.download_authorized',
      resourceType: 'file',
      resourceId: claimed.id,
      result: 'success',
      requestId: opts.requestId,
      ipHash: opts.ipHash,
      userAgent: opts.userAgent,
      metadata: {
        filename: claimed.original_name,
        size_bytes: claimed.size_bytes,
        burn_after_read: claimed.burn_after_read === 1,
        download_count: claimed.download_count,
      },
    });

    return {
      file: claimed,
      burn: claimed.burn_after_read === 1,
    };
  }

  /** 读取 R2 对象。返回 null 表示对象缺失。 */
  async getObject(objectKey: string): Promise<R2ObjectBody | null> {
    const obj = await this.env.FILES.get(objectKey);
    return obj;
  }

  /** 构建文件响应(§16.5)。 */
  buildDownloadResponse(file: FileRow, body: Readonly<ArrayBuffer> | ArrayBuffer | ReadableStream | null): Response {
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachmentContentDisposition(file.original_name),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Length': String(file.size_bytes),
    });
    if (body == null) return new Response(null, { status: 404, headers });
    return new Response(body, { headers });
  }

  /**
   * §17 私有下载。只允许 status='ready'。
   * 不消耗公开下载次数,不触发阅后即焚。
   */
  async privateDownload(
    id: string,
    ownerKeyId: string,
  ): Promise<{ file: FileRow; body: ArrayBuffer | ReadableStream } | { error: ApiError }> {
    const file = await fileRepo.getFileForPrivateDownload(this.env.DB, id, ownerKeyId);
    if (!file) return { error: diagnosePrivateFileError(await fileRepo.getFileByIdAndOwner(this.env.DB, id, ownerKeyId)) };
    const obj = await this.env.FILES.get(file.object_key);
    if (!obj) return { error: fileNotFound('File storage object is missing.') };
    return { file, body: obj.body };
  }

  /** §24 删除文件(软删除 + 异步 R2 清理,幂等)。非所有者视为不存在。 */
  async deleteFile(
    id: string,
    ownerKeyId: string | null,
    actor: { requestId: string; ipHash: string | null; userAgent: string | null; waitUntil?: (p: Promise<unknown>) => void },
  ): Promise<FileRow | null> {
    const now = nowMs();
    const file = await fileRepo.getFileById(this.env.DB, id);
    if (!file) return null;
    if (ownerKeyId && file.owner_key_id !== ownerKeyId) return null;

    if (file.status !== 'deleted') {
      const updated = ownerKeyId
        ? await fileRepo.softDeleteFile(this.env.DB, id, ownerKeyId, now)
        : await fileRepo.softDeleteFileAnyOwner(this.env.DB, id, now);
      if (!updated) return null; // 并发下已被删除或状态异常
      await this.audit.record({
        ownerKeyId: file.owner_key_id,
        actorType: ownerKeyId ? 'api_key' : 'root_key',
        actorId: ownerKeyId ?? 'root',
        action: 'file.deleted',
        resourceType: 'file',
        resourceId: id,
        result: 'success',
        requestId: actor.requestId,
        ipHash: actor.ipHash,
        userAgent: actor.userAgent,
        metadata: { filename: file.original_name },
      });
      // 异步删除 R2 对象;挂到请求生命周期,避免被运行时回收(§24)
      const cleanup = this.env.FILES.delete(file.object_key).catch(() => {});
      if (actor.waitUntil) actor.waitUntil(cleanup);
      else void cleanup;
    }
    return file;
  }

  /** §9.1 配额 best-effort 预检(仅在 Key 配置了配额时生效)。 */
  private async checkQuota(
    ownerKeyId: string,
    newSizeBytes: number,
    maxStorageBytes: number | null | undefined,
    maxActiveFiles: number | null | undefined,
  ): Promise<void> {
    if (maxStorageBytes != null || maxActiveFiles != null) {
      const [storage, count] = await Promise.all([
        fileRepo.sumActiveStorageBytes(this.env.DB, ownerKeyId),
        fileRepo.countActiveFiles(this.env.DB, ownerKeyId),
      ]);
      if (maxStorageBytes != null && storage + newSizeBytes > maxStorageBytes) {
        throw quotaExceeded('Storage quota exceeded.', { max_storage_bytes: maxStorageBytes });
      }
      if (maxActiveFiles != null && count + 1 > maxActiveFiles) {
        throw quotaExceeded('Active file count quota exceeded.', { max_active_files: maxActiveFiles });
      }
    }
  }

  /** 列表(服务层只做分页透传,租户过滤由路由强制)。 */
  async list(opts: fileRepo.FileListOptions): Promise<fileRepo.FileListResult> {
    return fileRepo.listFiles(this.env.DB, opts);
  }

  async getForOwner(id: string, ownerKeyId: string): Promise<FileRow | null> {
    return fileRepo.getFileByIdAndOwner(this.env.DB, id, ownerKeyId);
  }

  async getAny(id: string): Promise<FileRow | null> {
    return fileRepo.getFileById(this.env.DB, id);
  }
}

function diagnosePublicFileError(file: FileRow | null, now: number): ApiError {
  if (!file) return fileNotFound();
  switch (file.status) {
    case 'uploading':
      return fileNotReady();
    case 'failed':
    case 'deleted':
      return fileNotFound();
    case 'expired':
      return fileExpired();
    case 'consumed':
      return fileConsumed();
    case 'ready':
      if (isExpired(file.expires_at, now)) return fileExpired();
      if (file.max_downloads != null && file.download_count >= file.max_downloads) {
        return downloadLimitReached();
      }
      return fileNotFound();
    default:
      return fileNotFound();
  }
}

function diagnosePrivateFileError(file: FileRow | null): ApiError {
  if (!file) return fileNotFound();
  switch (file.status) {
    case 'ready':
      return fileNotFound('File storage object is missing.');
    case 'consumed':
      return fileConsumed();
    case 'expired':
      return fileExpired();
    case 'deleted':
      return fileDeleted();
    case 'failed':
      return fileNotFound();
    default:
      return fileNotFound();
  }
}
