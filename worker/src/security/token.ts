/**
 * 公开 Token 生成与解析。
 * - 下载/上传 Token:32 字节安全随机数,Base64URL 无填充。
 * - 数据库只保存 HMAC-SHA-256(TOKEN_HASH_PEPPER, token)。
 * - API Key 格式:afx_<key_id>_<secret>,secret 为 32 字节随机数据 Base64URL。
 */

import { hmacSha256Hex } from './hmac';

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** 生成 32 字节随机 Token(Base64URL 无填充,43 字符)。 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** 校验 Token 格式:必须可解码为恰好 32 字节。 */
export function isValidToken(token: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const bytes = base64UrlToBytes(token);
  return bytes !== null && bytes.length === 32;
}

export async function tokenHash(pepper: string, token: string): Promise<string> {
  return hmacSha256Hex(pepper, `public-token:${token}`);
}

/** 生成完整 API Key:afx_<key_id>_<secret>。 */
export function generateApiKey(keyId: string): { apiKey: string; secret: string; secretPrefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = bytesToBase64Url(bytes);
  return {
    apiKey: `afx_${keyId}_${secret}`,
    secret,
    secretPrefix: secret.slice(0, 8),
  };
}

export async function apiKeySecretHash(pepper: string, secret: string): Promise<string> {
  return hmacSha256Hex(pepper, `api-key-secret:${secret}`);
}

export interface ParsedApiKey {
  keyId: string;
  secret: string;
}

/** 解析 afx_<key_id>_<secret>,非法返回 null。 */
export function parseApiKey(apiKey: string): ParsedApiKey | null {
  const m = /^afx_([0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{43})$/.exec(apiKey);
  if (!m) return null;
  return { keyId: m[1]!, secret: m[2]! };
}
