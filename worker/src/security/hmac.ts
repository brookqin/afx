/** HMAC-SHA-256 摘要工具。所有 Token / Key 摘要均经此模块计算。 */

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(sig);
}

/** IP 日轮换 Salt:固定 Secret + UTC 日期。 */
export async function dailyIpSalt(pepper: string, utcDate: string): Promise<string> {
  return hmacSha256Hex(pepper, `ip-daily-salt:${utcDate}`);
}
