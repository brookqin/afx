import { beforeAll, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigration, createKey, putDirectUploadObject, ROOT_KEY } from '../helpers';
import * as fileRepo from '../../src/repositories/file-repository';
import { AuditService } from '../../src/services/audit-service';
import { CleanupService } from '../../src/services/cleanup-service';
import { promoteDirectUpload, signDirectPut, stagingObjectKey } from '../../src/services/direct-upload-service';

beforeAll(applyMigration);

async function initiate(apiKey: string, sizeBytes: number, filename = 'direct.bin', contentType: string | null = 'application/octet-stream') {
  const response = await SELF.fetch('http://localhost/api/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ filename, size_bytes: sizeBytes, content_type: contentType }),
  });
  return { response, body: (await response.json()) as any };
}

describe('R2 直传协议', () => {
  it('未配置直传时返回稳定错误码，供页面本地化', async () => {
    await expect(signDirectPut({ ...env, R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' }, 'uploads/test', 'text/plain'))
      .rejects.toMatchObject({ code: 'direct_upload_not_configured', status: 500 });
  });

  it('JSON 元数据请求超过 64 KiB 时在解析前拒绝', async () => {
    const key = await createKey('direct-json-limit');
    const response = await SELF.fetch('http://localhost/api/files', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'x'.repeat(70_000), size_bytes: 1 }),
    });
    const body = (await response.json()) as any;
    expect(response.status).toBe(413);
    expect(body.error.code).toBe('request_too_large');
  });

  it('使用独立暂存 Key 和存储侧 CopyObject 发布,旧 PUT URL 不指向最终对象', async () => {
    let copyRequest: Request | null = null;
    await promoteDirectUpload(
      env,
      'uploads/objects/tenant/file',
      'objects/tenant/file',
      'text/plain',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        copyRequest = new Request(input, init);
        return new Response('<CopyObjectResult/>', { status: 200 });
      }) as typeof fetch,
    );
    expect(copyRequest).not.toBeNull();
    expect(new URL(copyRequest!.url).pathname).toBe('/agent-file-exchange/objects/tenant/file');
    expect(copyRequest!.headers.get('x-amz-copy-source')).toBe('/agent-file-exchange/uploads/objects/tenant/file');
    expect(copyRequest!.headers.get('cf-copy-destination-if-none-match')).toBe('*');
  });

  it('Worker 只创建签名会话,HEAD 确认后才发布文件', async () => {
    const key = await createKey('direct-1');
    const session = await initiate(key.apiKey, 5);
    expect(session.response.status).toBe(201);
    expect(session.body.data.upload_method).toBe('PUT');
    expect(session.body.data.upload_headers['Content-Type']).toBe('application/octet-stream');
    const signed = new URL(session.body.data.upload_url);
    expect(signed.hostname).toBe('test-account-id.r2.cloudflarestorage.com');
    expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');

    const row = await env.DB.prepare('SELECT object_key, status FROM files WHERE id = ?')
      .bind(session.body.data.id).first<{ object_key: string; status: string }>();
    expect(row?.status).toBe('uploading');
    expect(await env.FILES.head(row!.object_key)).toBeNull();
    expect(await env.FILES.head(stagingObjectKey(row!.object_key))).toBeNull();

    const early = await SELF.fetch(`http://localhost/api/files/${session.body.data.id}/complete`, {
      method: 'POST', headers: { authorization: `Bearer ${key.apiKey}` },
    });
    expect(early.status).toBe(409);

    await putDirectUploadObject(row!.object_key, 'hello');
    const completed = await SELF.fetch(`http://localhost/api/files/${session.body.data.id}/complete`, {
      method: 'POST', headers: { authorization: `Bearer ${key.apiKey}` },
    });
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as any).data.file.status).toBe('ready');
  });

  it('声明大小与 R2 对象不一致时拒绝并删除对象', async () => {
    const key = await createKey('direct-2');
    const session = await initiate(key.apiKey, 5);
    const row = await env.DB.prepare('SELECT object_key FROM files WHERE id = ?')
      .bind(session.body.data.id).first<{ object_key: string }>();
    await env.FILES.put(stagingObjectKey(row!.object_key), 'too-long');
    const completed = await SELF.fetch(`http://localhost/api/files/${session.body.data.id}/complete`, {
      method: 'POST', headers: { authorization: `Bearer ${key.apiKey}`, accept: 'application/json' },
    });
    const body = (await completed.json()) as any;
    expect(completed.status).toBe(409);
    expect(body.error.code).toBe('uploaded_object_mismatch');
    expect(await env.FILES.head(stagingObjectKey(row!.object_key))).toBeNull();
  });

  it('MIME 白名单不再允许空 MIME 绕过', async () => {
    const key = await createKey('direct-3');
    const inbox = await SELF.fetch('http://localhost/api/inboxes', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ allowed_content_types: ['text/plain'] }),
    });
    const inboxBody = (await inbox.json()) as any;
    const initiated = await SELF.fetch(`${inboxBody.data.upload_url}/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ filename: 'a.txt', size_bytes: 1, content_type: null }),
    });
    expect(initiated.status).toBe(415);
  });

  it('Inbox expected_filename 会在签发 URL 前强制执行', async () => {
    const key = await createKey('direct-expected-name');
    const inbox = await SELF.fetch('http://localhost/api/inboxes', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_filename: 'expected.log' }),
    });
    const inboxBody = (await inbox.json()) as any;
    const wrong = await SELF.fetch(`${inboxBody.data.upload_url}/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ filename: 'other.log', size_bytes: 1, content_type: 'text/plain' }),
    });
    expect(wrong.status).toBe(415);
    const right = await SELF.fetch(`${inboxBody.data.upload_url}/initiate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ filename: 'expected.log', size_bytes: 1, content_type: 'text/plain' }),
    });
    expect(right.status).toBe(201);
  });

  it('ready 文件可在 Inbox 租约丢失补偿时转为 failed', async () => {
    const key = await createKey('direct-4');
    const session = await initiate(key.apiKey, 1);
    const row = await env.DB.prepare('SELECT object_key FROM files WHERE id = ?')
      .bind(session.body.data.id).first<{ object_key: string }>();
    await putDirectUploadObject(row!.object_key, 'x');
    await SELF.fetch(`http://localhost/api/files/${session.body.data.id}/complete`, {
      method: 'POST', headers: { authorization: `Bearer ${key.apiKey}` },
    });
    await fileRepo.markFileFailed(env.DB, session.body.data.id, 'lease_lost');
    const file = await fileRepo.getFileById(env.DB, session.body.data.id);
    expect(file?.status).toBe('failed');
  });
});

describe('R2 清理推进', () => {
  it('签名过期后清理 ready 文件的暂存副本但保留最终对象', async () => {
    const key = await createKey('cleanup-staging');
    const now = Date.now();
    const finalKey = `objects/${key.id}/staging-cleanup`;
    await fileRepo.createFile(env.DB, {
      id: 'STAGINGCLEANUP000000000000',
      ownerKeyId: key.id,
      source: 'agent_upload',
      objectKey: finalKey,
      originalName: 'ready.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 1,
      sha256: null,
      publicTokenHash: null,
      status: 'ready',
      createdAt: now - 10_000,
      expiresAt: now + 60_000,
      maxDownloads: null,
      burnAfterRead: false,
      uploadExpiresAt: now - 1,
    });
    await env.FILES.put(stagingObjectKey(finalKey), 'x');
    await env.FILES.put(finalKey, 'x');
    const result = await new CleanupService(env, new AuditService(env)).run();
    expect(result.deletedUploadObjects).toBe(1);
    expect(await env.FILES.head(stagingObjectKey(finalKey))).toBeNull();
    expect(await env.FILES.head(finalKey)).not.toBeNull();
  });

  it('超过单批 200 条时每条只标记一次并处理下一批', async () => {
    const key = await createKey('cleanup-1');
    const now = Date.now();
    for (let i = 0; i < 205; i++) {
      await fileRepo.createFile(env.DB, {
        id: `CLEANUP${String(i).padStart(19, '0')}`,
        ownerKeyId: key.id,
        source: 'agent_upload',
        objectKey: `objects/${key.id}/cleanup/${i}`,
        originalName: `${i}.bin`,
        contentType: 'application/octet-stream',
        sizeBytes: 1,
        sha256: null,
        publicTokenHash: null,
        status: 'deleted',
        createdAt: now,
        expiresAt: now + 1000,
        maxDownloads: null,
        burnAfterRead: false,
      });
    }
    const cleanup = new CleanupService(env, new AuditService(env));
    const result = await cleanup.run();
    expect(result.deletedObjects).toBe(205);
    const marked = await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE r2_deleted_at IS NOT NULL').first<{ n: number }>();
    expect(Number(marked?.n)).toBe(205);
  });
});

it('Root Inbox 详情没有重复 data 嵌套', async () => {
  const key = await createKey('root-inbox-shape');
  const created = await SELF.fetch('http://localhost/api/inboxes', {
    method: 'POST', headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' }, body: '{}',
  });
  const createdBody = (await created.json()) as any;
  const detail = await SELF.fetch(`http://localhost/api/root/inboxes/${createdBody.data.id}`, {
    headers: { authorization: `Bearer ${ROOT_KEY}` },
  });
  const detailBody = (await detail.json()) as any;
  expect(detailBody.data.id).toBe(createdBody.data.id);
  expect(detailBody.data.data).toBeUndefined();
});
