/**
 * IP Hash 工具:HMAC-SHA-256(日轮换 Salt, ip)。
 * 不长期保存原始 IP(§26)。日 Salt 由 IP_HASH_PEPPER + UTC 日期派生。
 */

import type { Context } from 'hono';
import { dailyIpSalt, hmacSha256Hex } from '../security/hmac';
import { utcDateString } from '../util/time';

export async function ipHashOf(c: Context): Promise<string | null> {
  const ip = c.req.header('cf-connecting-ip');
  if (!ip) return null;
  const env = (c.env ?? {}) as { IP_HASH_PEPPER?: string };
  const salt = await dailyIpSalt(env.IP_HASH_PEPPER ?? '', utcDateString());
  return hmacSha256Hex(salt, ip);
}
