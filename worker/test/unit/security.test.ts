/** 单元测试:安全模块(§36.1)。 */

import { describe, it, expect } from 'vitest';
import { generateToken, isValidToken, tokenHash, parseApiKey, generateApiKey, apiKeySecretHash } from '../../src/security/token';
import { hmacSha256Hex, toHex, dailyIpSalt } from '../../src/security/hmac';
import { constantTimeEqual } from '../../src/security/constant-time';
import { cleanFilename, basename } from '../../src/security/filename';
import { attachmentContentDisposition } from '../../src/security/content-disposition';
import { ulid, isValidUlid } from '../../src/util/id';

describe('token', () => {
  it('generates 43-char base64url tokens', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidToken(t)).toBe(true);
  });

  it('rejects invalid token formats', () => {
    expect(isValidToken('short')).toBe(false);
    expect(isValidToken('A'.repeat(43))).toBe(true);
    expect(isValidToken('A'.repeat(44))).toBe(false);
    expect(isValidToken('')).toBe(false);
  });

  it('tokens are unique and high-entropy', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateToken()));
    expect(set.size).toBe(1000);
  });

  it('tokenHash is deterministic and hex', async () => {
    const h1 = await tokenHash('pepper', 'token123');
    const h2 = await tokenHash('pepper', 'token123');
    const h3 = await tokenHash('pepper', 'token124');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('api key', () => {
  it('parses valid api key format', () => {
    const key = `afx_01J5ZD7A2F0000000000000000_${'A'.repeat(43)}`;
    const parsed = parseApiKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.keyId).toBe('01J5ZD7A2F0000000000000000');
    expect(parsed!.secret).toBe('A'.repeat(43));
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('not-a-key')).toBeNull();
    expect(parseApiKey('afx_x_123')).toBeNull();
    expect(parseApiKey('afx_root_AAAA')).toBeNull();
  });

  it('generates keys with correct prefix and 8-char secret prefix', () => {
    const { apiKey, secret, secretPrefix } = generateApiKey('01J5ZD7A2F0000000000000000');
    expect(apiKey.startsWith('afx_01J5ZD7A2F0000000000000000_')).toBe(true);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secretPrefix).toBe(secret.slice(0, 8));
    const parsed = parseApiKey(apiKey);
    expect(parsed!.secret).toBe(secret);
  });

  it('secret hash is deterministic', async () => {
    const h1 = await apiKeySecretHash('pepper', 'secret1');
    const h2 = await apiKeySecretHash('pepper', 'secret1');
    const h3 = await apiKeySecretHash('pepper', 'secret2');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('hmac', () => {
  it('produces 64-char hex output', async () => {
    const h = await hmacSha256Hex('k', 'data');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('toHex works', () => {
    const buf = Uint8Array.from([0x61, 0x62]).buffer;
    expect(toHex(buf)).toBe('6162');
  });

  it('daily ip salt varies by date', async () => {
    const s1 = await dailyIpSalt('pepper', '2026-08-01');
    const s2 = await dailyIpSalt('pepper', '2026-08-02');
    expect(s1).not.toBe(s2);
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('constant-time compare', () => {
  it('compares equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
  it('compares unequal strings', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });
});

describe('filename', () => {
  it('strips path components', () => {
    expect(basename('/etc/passwd')).toBe('passwd');
    expect(basename('C:\\Users\\x\\file.txt')).toBe('file.txt');
    expect(basename('file.txt')).toBe('file.txt');
  });

  it('rejects path traversal', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('..')).toBe('');
    expect(cleanFilename('.')).toBe('');
    expect(cleanFilename('')).toBe('');
  });

  it('strips control characters and NUL', () => {
    expect(cleanFilename('a\u0000b.txt')).toBe('ab.txt');
    expect(cleanFilename('a\u001fb.txt')).toBe('ab.txt');
  });

  it('truncates overly long utf-8 names without breaking multibyte chars', () => {
    const long = '汉'.repeat(200); // 600 bytes
    const cleaned = cleanFilename(long, 100);
    expect(new TextEncoder().encode(cleaned).length).toBeLessThanOrEqual(100);
    // 不得包含替换字符(说明未被截断到多字节字符中间)
    expect(cleaned).not.toContain('\uFFFD');
  });
});

describe('content-disposition', () => {
  it('produces attachment disposition with fallback', () => {
    const cd = attachmentContentDisposition('report.pdf');
    expect(cd.startsWith('attachment; filename="report.pdf"')).toBe(true);
    expect(cd).toContain("filename*=UTF-8''");
  });

  it('sanitizes quotes and backslashes in fallback', () => {
    const cd = attachmentContentDisposition('a"b\\c.txt');
    expect(cd).not.toContain('"b\\c');
    expect(cd).not.toContain('\\');
  });

  it('percent-encodes non-ASCII filename', () => {
    const cd = attachmentContentDisposition('报告.pdf');
    expect(cd).toContain('%E6%8A%A5%E5%91%8A.pdf');
  });

  it('uses fallback for empty names', () => {
    expect(attachmentContentDisposition('', 'fallback.bin')).toContain('filename="fallback.bin"');
  });
});

describe('ulid', () => {
  it('generates valid 26-char ULIDs', () => {
    const id = ulid();
    expect(isValidUlid(id)).toBe(true);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is time-ordered', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a < b).toBe(true);
  });
});
