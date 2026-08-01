/**
 * 接收邀请服务(§18-§21):
 * - 创建一次性上传链接(只返回一次明文 Token)。
 * - 公开上传:原子领取租约 -> 校验 -> 上传 -> 完成 Inbox。
 * - 失败释放租约;一次性语义 = 只允许一次成功上传。
 */

import type { Env } from '../env';
import {
  fileTooLarge,
  fileTypeNotAllowed,
  inboxAlreadyUsed,
  inboxExpired,
  inboxNotFound,
  inboxRevoked,
  inboxUploadFailed,
  inboxUploadInProgress,
  invalidRequest,
  invalidToken,
  fileNotFound,
  uploadNotComplete,
  uploadSessionExpired,
  uploadedObjectMismatch,
  ApiError,
} from '../errors';
import * as inboxRepo from '../repositories/inbox-repository';
import type { InboxRow } from '../repositories/inbox-repository';
import * as fileRepo from '../repositories/file-repository';
import type { FileRow } from '../repositories/file-repository';
import { getApiKeyById } from '../repositories/api-key-repository';
import { quotaExceeded } from '../errors';
import { cleanFilename } from '../security/filename';
import { generateToken, tokenHash } from '../security/token';
import { ulid } from '../util/id';
import { nowMs, isExpired, clampExpireSeconds } from '../util/time';
import type { AuditService } from './audit-service';
import {
  directUploadLifetimeSeconds,
  normalizeUploadContentType,
  promoteDirectUpload,
  signDirectPut,
  stagingObjectKey,
  type DirectUploadTarget,
} from './direct-upload-service';

export interface CreateInboxInput {
  ownerKeyId: string;
  actorId: string;
  expiresIn?: number;
  maxFileSizeBytes: number;
  /** Key 策略:默认有效期与最大有效期(§18.1) */
  defaultExpireSeconds: number;
  maxExpireSeconds: number;
  title?: string | null;
  description?: string | null;
  allowedExtensions: string[];
  allowedContentTypes: string[];
  expectedFilename?: string | null;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export interface CreateInboxResult {
  inbox: InboxRow;
  uploadUrl: string;
  rawToken: string;
}

export interface InitiateInboxUploadInput {
  token: string;
  filename: string;
  contentType?: string | null;
  sizeBytes: number;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export type InitiateInboxUploadResult =
  | { success: true; file: FileRow; inbox: InboxRow; uploadId: string; upload: DirectUploadTarget }
  | { success: false; error: ApiError; inbox?: InboxRow };

export interface CompleteInboxUploadInput {
  token: string;
  fileId: string;
  uploadId: string;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
}

export type CompleteInboxUploadResult =
  | { success: true; file: FileRow; inbox: InboxRow }
  | { success: false; error: ApiError; inbox?: InboxRow };

function objectKey(ownerKeyId: string, fileId: string): string {
  const d = new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `objects/${ownerKeyId}/${yyyy}/${mm}/${fileId}`;
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

export class InboxService {
  constructor(
    private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  /** §18 创建一次性接收链接。 */
  async create(input: CreateInboxInput): Promise<CreateInboxResult> {
    const now = nowMs();
    const id = ulid(now);
    const rawToken = generateToken();
    const hash = await tokenHash(this.env.TOKEN_HASH_PEPPER, rawToken);

    // §18.1:未传 expires_in 时使用 Key 默认值,且不得超过 Key 的最大值
    const expiresIn = clampExpireSeconds(input.expiresIn, input.defaultExpireSeconds, input.maxExpireSeconds);
    const expectedFilename = input.expectedFilename ? cleanFilename(input.expectedFilename) : null;
    if (input.expectedFilename && !expectedFilename) throw invalidRequest('Invalid expected filename.');
    const allowedExtensions = [...new Set(input.allowedExtensions.map((value) => value.toLowerCase()))];
    const allowedContentTypes = [...new Set(input.allowedContentTypes.map((value) => normalizeUploadContentType(value)))];

    await inboxRepo.createInbox(this.env.DB, {
      id,
      ownerKeyId: input.ownerKeyId,
      publicTokenHash: hash,
      title: input.title ?? null,
      description: input.description ?? null,
      createdAt: now,
      expiresAt: now + expiresIn * 1000,
      maxFileSizeBytes: input.maxFileSizeBytes,
      allowedExtensions,
      allowedContentTypes,
      expectedFilename,
    });

    await this.audit.record({
      ownerKeyId: input.ownerKeyId,
      actorType: 'api_key',
      actorId: input.actorId,
      action: 'inbox.created',
      resourceType: 'inbox',
      resourceId: id,
      result: 'success',
      requestId: input.requestId,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      metadata: { expires_in: expiresIn, max_file_size_bytes: input.maxFileSizeBytes },
    });

    const inbox = await inboxRepo.getInboxById(this.env.DB, id);
    if (!inbox) throw new Error('inbox not found after create');
    const base = this.env.PUBLIC_BASE_URL.replace(/\/$/, '');
    return { inbox, uploadUrl: `${base}/u/${rawToken}`, rawToken };
  }

  /** 公开上传页面数据。返回 null 表示不存在。 */
  async getPublicPage(token: string): Promise<InboxRow | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = await tokenHash(this.env.TOKEN_HASH_PEPPER, token);
    return inboxRepo.getInboxByTokenHash(this.env.DB, hash);
  }

  /** 校验邀请并签发一次性 R2 直传会话。 */
  async initiateUpload(input: InitiateInboxUploadInput): Promise<InitiateInboxUploadResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
      return { success: false, error: invalidToken() };
    }
    const hash = await tokenHash(this.env.TOKEN_HASH_PEPPER, input.token);
    const now = nowMs();
    const directLifetime = directUploadLifetimeSeconds(this.env);

    const pre = await inboxRepo.getInboxByTokenHash(this.env.DB, hash);
    if (!pre) return { success: false, error: inboxNotFound() };

    // 状态快速失败(已完成/过期/撤销)
    if (pre.status === 'completed') return { success: false, error: inboxAlreadyUsed(), inbox: pre };
    if (pre.status === 'expired') return { success: false, error: inboxExpired(), inbox: pre };
    if (pre.status === 'revoked') return { success: false, error: inboxRevoked(), inbox: pre };
    if (pre.status === 'uploading' && pre.upload_lease_until && pre.upload_lease_until > now) {
      return { success: false, error: inboxUploadInProgress(), inbox: pre };
    }
    if (isExpired(pre.expires_at, now)) {
      return { success: false, error: inboxExpired(), inbox: pre };
    }

    const ownerKey = await getApiKeyById(this.env.DB, pre.owner_key_id);
    const keyMaxBytes = ownerKey?.max_file_size_bytes ?? Number(this.env.DEFAULT_MAX_FILE_SIZE_BYTES || 104857600);
    const maxBytes = Math.min(pre.max_file_size_bytes, keyMaxBytes);
    if (input.sizeBytes > maxBytes) {
      return { success: false, error: fileTooLarge('File exceeds the maximum allowed size.', { max_size_bytes: maxBytes }), inbox: pre };
    }

    // §9.1 配额 best-effort 预检(仅当 Key 配置了配额时生效)
    if (ownerKey && (ownerKey.max_storage_bytes != null || ownerKey.max_active_files != null)) {
      const [storage, count] = await Promise.all([
        fileRepo.sumActiveStorageBytes(this.env.DB, pre.owner_key_id),
        fileRepo.countActiveFiles(this.env.DB, pre.owner_key_id),
      ]);
      if (ownerKey.max_storage_bytes != null && storage + input.sizeBytes > ownerKey.max_storage_bytes) {
        return { success: false, error: quotaExceeded('Storage quota exceeded.', { max_storage_bytes: ownerKey.max_storage_bytes }), inbox: pre };
      }
      if (ownerKey.max_active_files != null && count + 1 > ownerKey.max_active_files) {
        return { success: false, error: quotaExceeded('Active file count quota exceeded.', { max_active_files: ownerKey.max_active_files }), inbox: pre };
      }
    }

    const cleanName = cleanFilename(input.filename || 'file.bin');
    if (!cleanName) {
      return { success: false, error: invalidRequest('Invalid filename.'), inbox: pre };
    }
    if (pre.expected_filename && cleanName !== pre.expected_filename) {
      return {
        success: false,
        error: fileTypeNotAllowed('Filename does not match the invitation.', { expected_filename: pre.expected_filename }),
        inbox: pre,
      };
    }

    // 扩展名 / MIME 辅助白名单(非安全边界)
    const exts: string[] = JSON.parse(pre.allowed_extensions_json || '[]');
    const types: string[] = JSON.parse(pre.allowed_content_types_json || '[]');
    const ext = extOf(cleanName);
    if (exts.length > 0 && !exts.includes(ext)) {
      return { success: false, error: fileTypeNotAllowed('File extension is not allowed.', { allowed_extensions: exts }), inbox: pre };
    }
    const contentType = normalizeUploadContentType(input.contentType);
    if (types.length > 0 && !types.includes(contentType)) {
      return { success: false, error: fileTypeNotAllowed('File content type is not allowed.', { allowed_content_types: types }), inbox: pre };
    }

    const leaseId = ulid(now);
    const leaseUntil = Math.min(pre.expires_at, now + directLifetime * 1000);
    const inbox = await inboxRepo.claimInboxLease(this.env.DB, hash, leaseId, now, leaseUntil);
    if (!inbox) {
      const after = await inboxRepo.getInboxByTokenHash(this.env.DB, hash);
      const err = after ? this.diagnoseInbox(after, now) : inboxNotFound();
      return { success: false, error: err, inbox: after ?? pre };
    }

    // A 已过期、B 重新领取时,使 A 创建的 uploading 文件进入 failed。
    await fileRepo.failUploadingFilesForInbox(this.env.DB, inbox.id, 'lease_superseded');

    const fileId = ulid(now);
    const key = objectKey(inbox.owner_key_id, fileId);
    try {
      await fileRepo.createFile(this.env.DB, {
        id: fileId,
        ownerKeyId: inbox.owner_key_id,
        source: 'inbox_upload',
        objectKey: key,
        originalName: cleanName,
        contentType,
        sizeBytes: input.sizeBytes,
        sha256: null,
        publicTokenHash: null,
        status: 'uploading',
        createdAt: now,
        expiresAt: inbox.expires_at,
        maxDownloads: null,
        burnAfterRead: false,
        inboxId: inbox.id,
        metadata: {},
        uploadExpiresAt: leaseUntil,
      });
      const upload = await signDirectPut(
        this.env,
        stagingObjectKey(key),
        contentType,
        Math.max(1, Math.floor((leaseUntil - now) / 1000)),
      );
      await this.audit.record({
        ownerKeyId: inbox.owner_key_id,
        actorType: 'public_upload',
        action: 'inbox.upload_claimed',
        resourceType: 'inbox',
        resourceId: inbox.id,
        result: 'success',
        requestId: input.requestId,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
        metadata: { file_id: fileId, direct_upload: true },
      });
      const file = await fileRepo.getFileById(this.env.DB, fileId);
      if (!file) throw new Error('file not found after create');
      return { success: true, file, inbox, uploadId: leaseId, upload };
    } catch (err) {
      await fileRepo.markFileFailed(this.env.DB, fileId, 'initiate_failed');
      await inboxRepo.releaseInboxLease(this.env.DB, inbox.id, leaseId, nowMs());
      throw err;
    }
  }

  /** 验证 R2 HEAD 后完成一次性 Inbox。 */
  async completeUpload(input: CompleteInboxUploadInput): Promise<CompleteInboxUploadResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) return { success: false, error: invalidToken() };
    const hash = await tokenHash(this.env.TOKEN_HASH_PEPPER, input.token);
    const now = nowMs();
    const inbox = await inboxRepo.getInboxByTokenHash(this.env.DB, hash);
    if (!inbox) return { success: false, error: inboxNotFound() };
    if (inbox.status === 'completed') return { success: false, error: inboxAlreadyUsed(), inbox };
    if (inbox.status === 'expired' || isExpired(inbox.expires_at, now)) return { success: false, error: inboxExpired(), inbox };
    if (inbox.status === 'revoked') return { success: false, error: inboxRevoked(), inbox };
    if (
      inbox.status !== 'uploading' ||
      inbox.upload_lease_id !== input.uploadId ||
      inbox.upload_lease_until == null ||
      inbox.upload_lease_until <= now
    ) {
      return { success: false, error: uploadSessionExpired(), inbox };
    }

    const file = await fileRepo.getFileById(this.env.DB, input.fileId);
    if (!file || file.inbox_id !== inbox.id || file.owner_key_id !== inbox.owner_key_id || file.status !== 'uploading') {
      return { success: false, error: inboxUploadFailed('Upload session does not match the invitation.'), inbox };
    }
    const uploadKey = stagingObjectKey(file.object_key);
    const object = await this.env.FILES.head(uploadKey);
    if (!object) return { success: false, error: uploadNotComplete(), inbox };
    if (object.size !== file.size_bytes) {
      await this.env.FILES.delete(uploadKey).catch(() => {});
      return {
        success: false,
        error: uploadedObjectMismatch(undefined, { expected_size_bytes: file.size_bytes, actual_size_bytes: object.size }),
        inbox,
      };
    }

    let published = await this.env.FILES.head(file.object_key);
    if (!published) {
      try {
        await promoteDirectUpload(this.env, uploadKey, file.object_key, normalizeUploadContentType(file.content_type));
      } catch (error) {
        published = await this.env.FILES.head(file.object_key);
        if (!published) throw error;
      }
      published ??= await this.env.FILES.head(file.object_key);
    }
    if (!published || published.size !== file.size_bytes) {
      return { success: false, error: inboxUploadFailed('Failed to verify the published object.'), inbox };
    }

    const ready = await fileRepo.markFileReady(this.env.DB, file.id, now, null);
    if (!ready) return { success: false, error: inboxUploadFailed('Failed to finalize uploaded file.'), inbox };
    const completed = await inboxRepo.completeInboxUpload(this.env.DB, inbox.id, input.uploadId, file.id, now);
    if (!completed) {
      await fileRepo.markFileFailed(this.env.DB, file.id, 'lease_lost');
      await Promise.all([
        this.env.FILES.delete(file.object_key).catch(() => {}),
        this.env.FILES.delete(uploadKey).catch(() => {}),
      ]);
      await this.audit.record({
        ownerKeyId: inbox.owner_key_id,
        actorType: 'public_upload',
        action: 'inbox.upload_failed',
        resourceType: 'inbox',
        resourceId: file.id,
        result: 'failed',
        requestId: input.requestId,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
        metadata: { reason: 'lease_lost' },
      });
      return { success: false, error: inboxUploadFailed('Upload lease lost.'), inbox };
    }

    await this.audit.record({
      ownerKeyId: inbox.owner_key_id,
      actorType: 'public_upload',
      action: 'inbox.upload_completed',
      resourceType: 'inbox',
      resourceId: inbox.id,
      result: 'success',
      requestId: input.requestId,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      metadata: { filename: file.original_name, size_bytes: file.size_bytes, direct_upload: true },
    });
    await this.audit.record({
      ownerKeyId: inbox.owner_key_id,
      actorType: 'public_upload',
      action: 'file.upload_completed',
      resourceType: 'file',
      resourceId: file.id,
      result: 'success',
      requestId: input.requestId,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
      metadata: { filename: file.original_name, size_bytes: file.size_bytes, direct_upload: true },
    });

    return { success: true, file: ready, inbox: completed };
  }

  /** 诊断 Inbox 状态错误(用于租约领取失败后的二次确认)。 */
  diagnoseInbox(inbox: InboxRow, now: number): ApiError {
    switch (inbox.status) {
      case 'completed':
        return inboxAlreadyUsed();
      case 'expired':
        return inboxExpired();
      case 'revoked':
        return inboxRevoked();
      case 'uploading':
        if (inbox.upload_lease_until && inbox.upload_lease_until > now) return inboxUploadInProgress();
        return inboxNotFound();
      case 'open':
        if (isExpired(inbox.expires_at, now)) return inboxExpired();
        return inboxNotFound();
      default:
        return inboxNotFound();
    }
  }

  /** §21.2 Agent 下载收到的文件。 */
  async downloadReceivedFile(
    inboxId: string,
    ownerKeyId: string,
  ): Promise<{ file: FileRow; body: ArrayBuffer | ReadableStream } | { error: ApiError }> {
    const inbox = await inboxRepo.getInboxByIdAndOwner(this.env.DB, inboxId, ownerKeyId);
    if (!inbox) return { error: inboxNotFound() };
    if (inbox.status !== 'completed' || !inbox.received_file_id) {
      return { error: inboxNotFound('No file has been received yet.') };
    }
    const file = await fileRepo.getFileForInboxOwnerDownload(this.env.DB, inbox.id, ownerKeyId);
    if (!file || file.inbox_id !== inbox.id) return { error: fileNotFound() };
    const obj = await this.env.FILES.get(file.object_key);
    if (!obj) return { error: fileNotFound('File storage object is missing.') };
    return { file, body: obj.body };
  }

  /** 撤销 Inbox(幂等)。 */
  async revoke(
    id: string,
    ownerKeyId: string | null,
    actor: { requestId: string; ipHash: string | null; userAgent: string | null },
  ): Promise<InboxRow | null> {
    const now = nowMs();
    const updated = ownerKeyId
      ? await inboxRepo.revokeInbox(this.env.DB, id, ownerKeyId, now)
      : await inboxRepo.revokeInbox(this.env.DB, id, null, now);
    const inbox = await inboxRepo.getInboxById(this.env.DB, id);
    if (!inbox) return null;
    if (updated) {
      await this.audit.record({
        ownerKeyId: inbox.owner_key_id,
        actorType: ownerKeyId ? 'api_key' : 'root_key',
        actorId: ownerKeyId ?? 'root',
        action: 'inbox.revoked',
        resourceType: 'inbox',
        resourceId: id,
        result: 'success',
        requestId: actor.requestId,
        ipHash: actor.ipHash,
        userAgent: actor.userAgent,
        metadata: {},
      });
    }
    return inbox;
  }

  async getForOwner(id: string, ownerKeyId: string): Promise<InboxRow | null> {
    return inboxRepo.getInboxByIdAndOwner(this.env.DB, id, ownerKeyId);
  }

  async getAny(id: string): Promise<InboxRow | null> {
    return inboxRepo.getInboxById(this.env.DB, id);
  }

  async list(opts: inboxRepo.InboxListOptions): Promise<inboxRepo.InboxListResult> {
    return inboxRepo.listInboxes(this.env.DB, opts);
  }
}
