/**
 * ULID 风格 ID 生成器(Crockford Base32,26 字符,时间前缀+随机后缀)。
 * 用于 file_id / inbox_id / api_key_id / request_id。
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now: number = Date.now()): string {
  const time = BigInt(now) << 80n;
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  let r = 0n;
  for (const b of rand) r = (r << 8n) | BigInt(b);
  const val = time | r;
  const chars = new Array<string>(26);
  for (let i = 0; i < 26; i++) {
    const shift = 5n * BigInt(25 - i);
    chars[i] = CROCKFORD[Number((val >> shift) & 0x1fn)] ?? '';
  }
  return chars.join('');
}

const KEY_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidUlid(s: string): boolean {
  return KEY_ID_RE.test(s);
}
