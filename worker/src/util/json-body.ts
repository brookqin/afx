import type { Context } from 'hono';
import { invalidJson, requestTooLarge } from '../errors';

export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** 在解析前流式限制 JSON 大小，避免 chunked 请求绕过 Content-Length 预检。 */
export async function parseJsonBody(
  c: Context,
  options: { allowEmpty?: boolean; maxBytes?: number } = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw requestTooLarge();

  const reader = c.req.raw.body?.getReader();
  if (!reader) {
    if (options.allowEmpty) return {};
    throw invalidJson();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw requestTooLarge();
    }
    chunks.push(value);
  }
  if (total === 0 && options.allowEmpty) return {};

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw invalidJson();
  }
}
