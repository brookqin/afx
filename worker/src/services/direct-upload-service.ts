/** R2 direct-upload URL signing. File bytes never pass through the Worker. */

import { AwsClient } from 'aws4fetch';
import type { Env } from '../env';
import { directUploadNotConfigured, internalError } from '../errors';

const DEFAULT_EXPIRES_SECONDS = 15 * 60;
const MIN_EXPIRES_SECONDS = 60;
const MAX_EXPIRES_SECONDS = 60 * 60;

export interface DirectUploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: number;
}

/** 上传 URL 永远只指向暂存 Key；ready 文件使用另一个不可被该 URL 覆盖的 Key。 */
export function stagingObjectKey(finalObjectKey: string): string {
  return `uploads/${finalObjectKey}`;
}

function encodedObjectKey(objectKey: string): string {
  return objectKey.split('/').map(encodeURIComponent).join('/');
}

function objectUrl(env: Env, objectKey: string): URL {
  return new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodedObjectKey(objectKey)}`,
  );
}

function signer(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

function assertConfigured(env: Env): void {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw directUploadNotConfigured(undefined, 'Missing R2 S3 signing credentials.');
  }
}

export function directUploadLifetimeSeconds(env: Env): number {
  const configured = Number(env.DIRECT_UPLOAD_EXPIRES_SECONDS || DEFAULT_EXPIRES_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_EXPIRES_SECONDS;
  return Math.min(MAX_EXPIRES_SECONDS, Math.max(MIN_EXPIRES_SECONDS, Math.floor(configured)));
}

export function normalizeUploadContentType(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || 'application/octet-stream';
}

export async function signDirectPut(
  env: Env,
  objectKey: string,
  contentType: string,
  lifetimeSeconds = directUploadLifetimeSeconds(env),
): Promise<DirectUploadTarget> {
  assertConfigured(env);
  const url = objectUrl(env, objectKey);
  url.searchParams.set('X-Amz-Expires', String(lifetimeSeconds));

  const signed = await signer(env).sign(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    aws: { signQuery: true, allHeaders: true },
  });

  return {
    url: signed.url,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    expiresAt: Date.now() + lifetimeSeconds * 1000,
  };
}

/**
 * 使用 R2 S3 CopyObject 在存储侧把暂存对象提升为最终对象。
 * Copy 完成后旧 presigned PUT 仍只能改写暂存 Key，无法改写已发布文件。
 */
export async function promoteDirectUpload(
  env: Env,
  sourceObjectKey: string,
  finalObjectKey: string,
  contentType: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  assertConfigured(env);
  const copySource = `/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodedObjectKey(sourceObjectKey)}`;
  const signed = await signer(env).sign(objectUrl(env, finalObjectKey), {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-copy-source': copySource,
      'x-amz-metadata-directive': 'REPLACE',
      // 文件 ID 对应的最终 Key 只允许首次创建，避免异常重入覆盖 ready 对象。
      'cf-copy-destination-if-none-match': '*',
    },
    aws: { allHeaders: true },
  });
  const response = await fetcher(signed);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw internalError('Failed to publish uploaded object.', `R2 CopyObject returned HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => {});
}
