/**
 * 集成测试:Key 策略(expires/quota)、PATCH 吊销绕过、文件名过滤(§36.2 补充)。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigration, createKey, putDirectUploadObject, uploadFile, ROOT_KEY, respStatus } from '../helpers';

beforeAll(async () => {
  await applyMigration();
});

async function directInboxUpload(uploadUrl: string, content: string, filename: string): Promise<Response> {
  const initiated = await SELF.fetch(`${uploadUrl}/initiate`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ filename, size_bytes: content.length, content_type: 'application/octet-stream' }),
  });
  const session = (await initiated.json()) as any;
  if (!session.ok) return new Response(JSON.stringify(session), { status: initiated.status, headers: { 'content-type': 'application/json' } });
  const row = await env.DB.prepare('SELECT object_key FROM files WHERE id = ?').bind(session.data.file_id).first<{ object_key: string }>();
  if (!row) throw new Error('direct inbox upload row not found');
  await putDirectUploadObject(row.object_key, content);
  return SELF.fetch(`${uploadUrl}/complete`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: session.data.file_id, upload_id: session.data.upload_id }),
  });
}

describe('Key 有效期策略', () => {
  it('未传 expires_in 时使用 Key 默认值', async () => {
    const a = await createKey('policy-exp-1', { default_expire_seconds: 100, max_expire_seconds: 200 });
    const up = await uploadFile(a.apiKey, 'x', 'x.txt');
    expect(up.status).toBe(200);
    const expiresAt = new Date(up.body.data.expires_at).getTime();
    const delta = expiresAt - Date.now();
    expect(delta).toBeGreaterThan(90_000);
    expect(delta).toBeLessThanOrEqual(100_000);
  });

  it('expires_in 超过 Key 上限时被截断', async () => {
    const a = await createKey('policy-exp-2', { default_expire_seconds: 100, max_expire_seconds: 200 });
    const up = await uploadFile(a.apiKey, 'x', 'x.txt', '?expires_in=10000');
    expect(up.status).toBe(200);
    const delta = new Date(up.body.data.expires_at).getTime() - Date.now();
    expect(delta).toBeLessThanOrEqual(200_000);
  });

  it('Inbox 创建同样遵循 Key 有效期策略', async () => {
    const a = await createKey('policy-exp-3', { default_expire_seconds: 100, max_expire_seconds: 200 });
    const res = await SELF.fetch('http://localhost/api/inboxes', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expires_in: 10000, max_file_size_bytes: 1048576 }),
    });
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    const delta = new Date(json.data.expires_at).getTime() - Date.now();
    expect(delta).toBeLessThanOrEqual(200_000);
  });
});

describe('Key 配额', () => {
  it('max_active_files 超出后拒绝上传', async () => {
    const a = await createKey('policy-quota-1', { max_active_files: 1 });
    const first = await uploadFile(a.apiKey, 'one', '1.txt');
    expect(first.status).toBe(200);
    const second = await uploadFile(a.apiKey, 'two', '2.txt');
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('quota_exceeded');
  });

  it('max_storage_bytes 超出后拒绝上传', async () => {
    const a = await createKey('policy-quota-2', { max_storage_bytes: 15 });
    const first = await uploadFile(a.apiKey, '1234567890', 'a.txt'); // 10 bytes
    expect(first.status).toBe(200);
    const second = await uploadFile(a.apiKey, '1234567890', 'b.txt'); // 10 + 10 > 15
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('quota_exceeded');
  });

  it('删除文件后配额释放', async () => {
    const a = await createKey('policy-quota-3', { max_active_files: 1 });
    const first = await uploadFile(a.apiKey, 'one', '1.txt');
    expect(first.status).toBe(200);
    const del = await SELF.fetch(`http://localhost/api/files/${first.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(await respStatus(del)).toBe(200);
    const second = await uploadFile(a.apiKey, 'two', '2.txt');
    expect(second.status).toBe(200);
  });

  it('Inbox 上传同样受配额限制', async () => {
    const a = await createKey('policy-quota-4', { max_active_files: 1 });
    const inbox = await SELF.fetch('http://localhost/api/inboxes', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expires_in: 3600, max_file_size_bytes: 1048576 }),
    });
    const inboxJson = (await inbox.json()) as any;
    expect(inboxJson.ok).toBe(true);

    expect(await respStatus(await directInboxUpload(inboxJson.data.upload_url, 'a', 'a.log'))).toBe(200);
    const secondInbox = await SELF.fetch('http://localhost/api/inboxes', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expires_in: 3600, max_file_size_bytes: 1048576 }),
    });
    const secondJson = (await secondInbox.json()) as any;
    const second = await directInboxUpload(secondJson.data.upload_url, 'b', 'b.log');
    expect(await respStatus(second)).toBe(429);
  });
});

describe('PATCH 吊销防护', () => {
  it('PATCH status=revoked 被拒绝(吊销必须走 DELETE 带 resource_policy)', async () => {
    const a = await createKey('policy-patch-1');
    const res = await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'revoked' }),
    });
    expect(res.status).toBe(400);
    // Key 仍可用
    const ok = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(ok.status).toBe(200);
  });

  it('PATCH 可更新和清空配额并返回 metadata', async () => {
    const a = await createKey('policy-patch-quotas', { max_storage_bytes: 100, max_active_files: 2 });
    const res = await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ max_storage_bytes: null, max_active_files: 3, metadata: { team: 'ops' } }),
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.data.key.max_storage_bytes).toBeNull();
    expect(body.data.key.max_active_files).toBe(3);
    expect(body.data.key.metadata).toEqual({ team: 'ops' });
  });

  it('创建和 PATCH 都拒绝默认有效期大于最大有效期', async () => {
    const create = await SELF.fetch('http://localhost/api/root/keys', {
      method: 'POST',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad-expiry', default_expire_seconds: 200, max_expire_seconds: 100 }),
    });
    expect(create.status).toBe(400);

    const a = await createKey('policy-patch-expiry', { default_expire_seconds: 100, max_expire_seconds: 200 });
    const patch = await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ max_expire_seconds: 50 }),
    });
    expect(patch.status).toBe(400);
  });
});

describe('Root 文件名过滤', () => {
  it('filename 过滤按全量匹配且不影响分页', async () => {
    const a = await createKey('policy-name-1');
    await uploadFile(a.apiKey, 'x', 'match.txt');
    await uploadFile(a.apiKey, 'y', 'other.txt');
    const res = await SELF.fetch('http://localhost/api/root/files?filename=match.txt', {
      headers: { authorization: `Bearer ${ROOT_KEY}` },
    });
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.data.files).toHaveLength(1);
    expect(json.data.files[0].filename).toBe('match.txt');
  });
});
