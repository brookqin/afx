/**
 * 集成测试辅助:应用 Migration、创建 Root/普通 Key。
 */

import { env, SELF } from 'cloudflare:test';
import { vi } from 'vitest';
import migrationSql from '../migrations/0001_initial.sql?raw';
import fileDescriptionMigrationSql from '../migrations/0002_file_description.sql?raw';
import { stagingObjectKey } from '../src/services/direct-upload-service';

// 主 Worker 与测试位于同一 isolate；拦截出站 CopyObject，避免访问真实 R2 S3 端点。
vi.stubGlobal('fetch', vi.fn(async () => new Response('<CopyObjectResult/>', { status: 200 })));

export const ROOT_KEY = 'afx_root_USo7a18L20w6jnInYVeGi7cYR_0fV8aj7J8Zq6fOmY8';

export async function applyMigration(): Promise<void> {
  // 每测试文件独立存储(isolatedStorage),直接逐条应用 Migration
  // D1 exec 对多语句/注释解析严格:折叠空白为单行语句,逐条执行
  await applySql(migrationSql);
  await applySql(fileDescriptionMigrationSql);
}

async function applySql(sql: string): Promise<void> {
  const lines = sql.split('\n').filter((l) => !l.trim().startsWith('--'));
  let stmt = '';
  for (const line of lines) {
    stmt += line + '\n';
    if (stmt.trim().endsWith(';')) {
      await env.DB.exec(stmt.replace(/\s+/g, ' ').trim());
      stmt = '';
    }
  }
  if (stmt.trim()) await env.DB.exec(stmt.replace(/\s+/g, ' ').trim());
}

export interface KeyResult {
  id: string;
  apiKey: string;
}

export async function createKey(name: string, overrides: Record<string, unknown> = {}): Promise<KeyResult> {
  const body = {
    name,
    scopes: [
      'files:upload', 'files:list', 'files:read', 'files:delete',
      'inboxes:create', 'inboxes:list', 'inboxes:read', 'inboxes:delete',
      'audit:read', 'stats:read',
    ],
    max_file_size_bytes: 104857600,
    default_expire_seconds: 86400,
    max_expire_seconds: 604800,
    ...overrides,
  };
  const res = await SELF.fetch('http://localhost/api/root/keys', {
    method: 'POST',
    headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(`createKey failed: ${JSON.stringify(json)}`);
  return { id: json.data.id, apiKey: json.data.api_key };
}

export async function uploadFile(
  apiKey: string,
  content: string | Uint8Array,
  filename: string,
  query = '',
  description?: string,
): Promise<{ id: string; url: string; status: number; body: any }> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const requestBody: Record<string, unknown> = {
    filename,
    size_bytes: bytes.byteLength,
    content_type: 'application/octet-stream',
  };
  if (params.has('expires_in')) requestBody.expires_in = Number(params.get('expires_in'));
  if (params.has('max_downloads')) requestBody.max_downloads = Number(params.get('max_downloads'));
  if (params.get('burn_after_read') === 'true' || params.get('burn_after_read') === '1') requestBody.burn_after_read = true;
  if (description !== undefined) requestBody.description = description;

  const initiated = await SELF.fetch('http://localhost/api/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const initBody: any = await initiated.json();
  if (!initBody.ok) return { id: '', url: '', status: initiated.status, body: initBody };

  const id = initBody.data.id as string;
  const row = await env.DB.prepare('SELECT object_key FROM files WHERE id = ?').bind(id).first<{ object_key: string }>();
  if (!row) throw new Error('direct upload file row not found');
  await putDirectUploadObject(row.object_key, bytes);

  const completed = await SELF.fetch(`http://localhost/api/files/${id}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const completeBody: any = await completed.json();
  const body = completeBody.ok
    ? { ok: true, data: { id, url: initBody.data.download_url, expires_at: initBody.data.expires_at, ...completeBody.data.file } }
    : completeBody;
  return { id, url: initBody.data.download_url, status: completed.status, body };
}

/** 模拟客户端写暂存 Key，以及 R2 CopyObject 在存储侧生成最终 Key。 */
export async function putDirectUploadObject(
  finalObjectKey: string,
  content: string | Uint8Array,
  contentType = 'application/octet-stream',
): Promise<void> {
  const metadata = { httpMetadata: { contentType } };
  await env.FILES.put(stagingObjectKey(finalObjectKey), content, metadata);
  await env.FILES.put(finalObjectKey, content, metadata);
}

export function tokenFromUrl(url: string): string {
  return url.split('/').pop()!;
}

/**
 * 获取状态码并消费响应体。
 * 未消费的响应体会保持 R2 流打开,导致 isolated storage 无法正确弹出(§36.2)。
 */
export async function respStatus(resp: Response): Promise<number> {
  await resp.arrayBuffer().catch(() => {});
  return resp.status;
}

/** 并发请求 + 消费,返回 [状态码] 列表。 */
export async function parallelStatus(urls: string[], init?: RequestInit): Promise<number[]> {
  const results = await Promise.all(urls.map((u) => SELF.fetch(u, init)));
  return Promise.all(results.map((r) => respStatus(r)));
}
