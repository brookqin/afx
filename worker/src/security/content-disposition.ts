/**
 * RFC 6266 / RFC 5987 附件 Content-Disposition 生成。
 * 文件名不可信:fallback 使用 ASCII 净化值,UTF-8 值使用百分号编码。
 */

const ASCII_SAFE = /^[\x20-\x7e]+$/;

function percentEncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** 生成 attachment 的 Content-Disposition 头值。 */
export function attachmentContentDisposition(rawFilename: string, fallback = 'file.bin'): string {
  const name = rawFilename.length > 0 ? rawFilename : fallback;
  // 移除非 ASCII 和引号/反斜杠字符
  const asciiFallback = [...name]
    .map((ch) => (ASCII_SAFE.test(ch) && ch !== '"' && ch !== '\\' ? ch : '_'))
    .join('')
    .replace(/[\s.]+$/, '')
    .slice(0, 150) || fallback;
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${percentEncodeUtf8(name)}`;
}
