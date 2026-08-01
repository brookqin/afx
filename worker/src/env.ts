/**
 * Worker 环境绑定类型。字段与 wrangler.jsonc 的 vars / bindings 及部署 Secrets 对应。
 */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;

  PUBLIC_BASE_URL: string;
  DEFAULT_MAX_FILE_SIZE_BYTES: string;
  DIRECT_UPLOAD_EXPIRES_SECONDS: string;

  /** R2 S3 API credentials, only used to sign short-lived direct-upload URLs. */
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  ROOT_API_KEY_HASH: string;
  ROOT_API_KEY_PEPPER: string;
  API_KEY_PEPPER: string;
  TOKEN_HASH_PEPPER: string;
  IP_HASH_PEPPER: string;
}

/** 从环境变量解析字节数,失败或非法时返回 0 */
export function parseEnvBytes(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseEnvSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
