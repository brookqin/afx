/**
 * 认证服务(设计文档 §7):
 * - 普通 API Key:afx_<key_id>_<secret>,数据库只存 HMAC-SHA-256(API_KEY_PEPPER, secret)。
 * - Root Key:afx_root_<secret>,通过 Secret 配置,只校验摘要。
 */

import type { Env } from '../env';
import { apiKeyDisabled, apiKeyRevoked, invalidApiKey, scopeDenied } from '../errors';
import {
  getApiKeyById,
  touchLastUsed,
  type ApiKeyRow,
} from '../repositories/api-key-repository';
import { constantTimeEqual } from '../security/constant-time';
import { hmacSha256Hex } from '../security/hmac';
import {
  apiKeySecretHash,
  parseApiKey,
} from '../security/token';

const ROOT_KEY_RE = /^afx_root_([A-Za-z0-9_-]{43})$/;

export const SCOPES = [
  'files:upload',
  'files:list',
  'files:read',
  'files:delete',
  'inboxes:create',
  'inboxes:list',
  'inboxes:read',
  'inboxes:delete',
  'audit:read',
  'stats:read',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

export class AuthService {
  constructor(private readonly env: Env) {}

  /** 校验 Root Key。只接受 afx_root_<secret>。 */
  async verifyRoot(header: string | null): Promise<void> {
    if (!header) throw invalidApiKey();
    const m = ROOT_KEY_RE.exec(header);
    if (!m) throw invalidApiKey();
    const hash = await hmacSha256Hex(this.env.ROOT_API_KEY_PEPPER, m[1]!);
    if (!constantTimeEqual(hash, this.env.ROOT_API_KEY_HASH)) {
      throw invalidApiKey();
    }
  }

  /**
   * 校验普通 API Key 并返回记录。
   * 解析 -> 按 key_id 查库 -> 状态检查 -> HMAC 固定时间比较 -> scope 检查 -> 异步更新 last_used_at。
   */
  async verifyApiKey(header: string | null, requiredScope?: Scope): Promise<ApiKeyRow> {
    if (!header) throw invalidApiKey();
    const parsed = parseApiKey(header);
    if (!parsed) throw invalidApiKey();

    const key = await getApiKeyById(this.env.DB, parsed.keyId);
    if (!key) throw invalidApiKey();

    if (key.status === 'disabled') throw apiKeyDisabled();
    if (key.status === 'revoked') throw apiKeyRevoked();

    const hash = await apiKeySecretHash(this.env.API_KEY_PEPPER, parsed.secret);
    if (!constantTimeEqual(hash, key.secret_hash)) throw invalidApiKey();

    if (requiredScope) this.checkScope(key, requiredScope);

    // 限频更新 last_used_at:至多每 60 秒一次
    const now = Date.now();
    if (key.last_used_at == null || now - key.last_used_at > 60_000) {
      void touchLastUsed(this.env.DB, key.id, now).catch(() => {});
    }
    return key;
  }

  checkScope(key: ApiKeyRow, scope: Scope): void {
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(key.scopes_json);
    } catch {
      scopes = [];
    }
    if (!Array.isArray(scopes) || !scopes.includes(scope)) {
      throw scopeDenied(`Missing scope: ${scope}`);
    }
  }
}
