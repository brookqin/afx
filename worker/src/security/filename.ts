/**
 * 文件名安全清理(设计文档 §28.1):
 * - 取 basename(去掉路径)。
 * - 去除 NUL 与控制字符。
 * - 限制 UTF-8 字节长度(默认 255)。
 * - 不允许用于 R2 Object Key(Object Key 由服务端生成,与文件名无关)。
 */

const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

export function basename(raw: string): string {
  const idx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const name = idx >= 0 ? raw.slice(idx + 1) : raw;
  return name.replace(CONTROL_RE, '').trim();
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 按 UTF-8 字节数安全截断,不会切坏多字节字符。 */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(s.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

export const MAX_FILENAME_BYTES = 255;

/**
 * 清理客户端提供的文件名。返回空字符串表示无有效文件名。
 * 处理:路径穿越、控制字符、过长的多字节文件名、空名、`.`/`..`。
 */
export function cleanFilename(raw: string, maxBytes: number = MAX_FILENAME_BYTES): string {
  const base = basename(raw);
  if (!base || base === '.' || base === '..') return '';
  const truncated = truncateUtf8(base, maxBytes);
  // 去掉尾部空白与点,避免 Windows 兼容性问题
  return truncated.replace(/[\s.]+$/, '').replace(/^\s+/, '');
}
