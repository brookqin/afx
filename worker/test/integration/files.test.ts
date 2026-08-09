/**
 * 集成测试:认证、租户隔离、上传/下载、下载限制、阅后即焚(§36.2)。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigration, createKey, uploadFile, tokenFromUrl, ROOT_KEY, respStatus, parallelStatus } from '../helpers';

beforeAll(async () => {
  await applyMigration();
});

describe('认证与租户隔离', () => {
  it('无效 / 缺失 Key 返回 401', async () => {
    const res = await SELF.fetch('http://localhost/api/files', { headers: { authorization: 'Bearer bogus' } });
    expect(await respStatus(res)).toBe(401);
  });

  it('Key A 不能查看 Key B 的文件', async () => {
    const a = await createKey('tenant-a');
    const b = await createKey('tenant-b');
    const up = await uploadFile(a.apiKey, 'secret-a-data', 'a.txt');
    expect(up.status).toBe(200);

    const resB = await SELF.fetch(`http://localhost/api/files/${up.id}`, {
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(await respStatus(resB)).toBe(404);

    // B 的列表看不到 A 的文件
    const listB = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    const listJson = (await listB.json()) as any;
    expect(listJson.data.files).toHaveLength(0);
  });

  it('Key A 不能删除 Key B 的文件', async () => {
    const a = await createKey('tenant-a2');
    const b = await createKey('tenant-b2');
    const up = await uploadFile(a.apiKey, 'x', 'x.txt');
    const res = await SELF.fetch(`http://localhost/api/files/${up.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(await respStatus(res)).toBe(404);
  });

  it('普通 Key 不能访问 Root API', async () => {
    const a = await createKey('tenant-a3');
    const res = await SELF.fetch('http://localhost/api/root/files', {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(await respStatus(res)).toBe(401); // 普通 Key 不是有效 Root Key
  });

  it('Root Key 不能作为普通租户使用', async () => {
    const res = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${ROOT_KEY}` },
    });
    expect(await respStatus(res)).toBe(401);
  });

  it('吊销后的 Key 立即失效', async () => {
    const a = await createKey('tenant-a4');
    await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resource_policy: 'keep' }),
    });
    const res = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const resBody = (await res.json()) as any;
    expect(res.status).toBe(403);
    expect(resBody.error.code).toBe('api_key_revoked');
  });

  it('禁用的 Key 拒绝访问且可恢复', async () => {
    const a = await createKey('tenant-a5');
    await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    const denied = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const deniedBody = (await denied.json()) as any;
    expect(denied.status).toBe(403);
    expect(deniedBody.error.code).toBe('api_key_disabled');

    await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    const ok = await SELF.fetch('http://localhost/api/files', {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(await respStatus(ok)).toBe(200);
  });

  it('revoked 的 Key 不可恢复为 active', async () => {
    const a = await createKey('tenant-a6');
    await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resource_policy: 'keep' }),
    });
    const res = await SELF.fetch(`http://localhost/api/root/keys/${a.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ROOT_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(await respStatus(res)).toBe(400);
  });
});

describe('上传与下载', () => {
  it('公开链接返回 AI 友好的详情页，下载按钮端点返回文件', async () => {
    const a = await createKey('upload-1');
    const description = '季度报告\n<script>alert(1)</script>';
    const up = await uploadFile(a.apiKey, 'hello world', 'hello.txt', '', description);
    expect(up.status).toBe(200);
    expect(up.url).toContain('/d/');

    const page = await SELF.fetch(up.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('hello.txt');
    expect(html).toContain('季度报告');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('\\u003cscript>alert(1)\\u003c/script>');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('data-local-date');
    expect(html).toContain("timeZoneName: 'longOffset'");
    expect(html).toContain(`${tokenFromUrl(up.url)}/file`);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');

    const metadata = await SELF.fetch(up.url, { headers: { accept: 'application/json' } });
    const metadataBody = (await metadata.json()) as any;
    expect(metadata.status).toBe(200);
    expect(metadataBody.data).toMatchObject({
      filename: 'hello.txt',
      size_bytes: 11,
      description,
      content_type: 'application/octet-stream',
      download_url: `${up.url}/file`,
    });
    expect(metadataBody.data.uploaded_at).toMatch(/^\d{4}-/);

    const ownerDetail = await SELF.fetch(`http://localhost/api/files/${up.id}`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const ownerDetailBody = (await ownerDetail.json()) as any;
    expect(ownerDetailBody.data.file.description).toBe(description);

    const dl = await SELF.fetch(`${up.url}/file`);
    expect(dl.status).toBe(200);
    expect(new TextDecoder().decode(await dl.arrayBuffer())).toBe('hello world');
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('cache-control')).toBe('private, no-store');
  });

  it('空文件可上传', async () => {
    const a = await createKey('upload-2');
    const up = await uploadFile(a.apiKey, '', 'empty.bin');
    expect(up.status).toBe(200);
    const dl = await SELF.fetch(`${up.url}/file`);
    expect(dl.status).toBe(200);
    expect((await dl.arrayBuffer()).byteLength).toBe(0);
  });

  it('Content-Length 超限被拒绝', async () => {
    const a = await createKey('upload-3', { max_file_size_bytes: 10 });
    const up = await uploadFile(a.apiKey, 'x'.repeat(11), 'big.txt');
    expect(up.status).toBe(413);
    expect(up.body.error.code).toBe('file_too_large');
  });

  it('文件描述最多允许 2000 个字符', async () => {
    const a = await createKey('upload-description-limit');
    const res = await SELF.fetch('http://localhost/api/files', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: 'a.txt',
        size_bytes: 1,
        content_type: 'text/plain',
        description: 'x'.repeat(2001),
      }),
    });
    expect(await respStatus(res)).toBe(400);
  });

  it('不存在的下载 Token 返回 404', async () => {
    const dl = await SELF.fetch('http://localhost/d/' + 'A'.repeat(43));
    expect(await respStatus(dl)).toBe(404);
  });

  it('非法 Token 返回 400', async () => {
    const dl = await SELF.fetch('http://localhost/d/short');
    expect(await respStatus(dl)).toBe(400);
  });

  it('私有下载不增加公开下载计数', async () => {
    const a = await createKey('upload-4');
    const up = await uploadFile(a.apiKey, 'data', 'd.txt', '?max_downloads=1');
    // 私有下载
    const priv = await SELF.fetch(`http://localhost/api/files/${up.id}/content`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(await respStatus(priv)).toBe(200);
    // 公开下载仍可用(计数未被私有下载消耗)
    const dl = await SELF.fetch(`${up.url}/file`);
    expect(await respStatus(dl)).toBe(200);
    // 公开额度耗尽
    const dl2 = await SELF.fetch(`${up.url}/file`);
    expect(await respStatus(dl2)).toBe(410);
  });
});

describe('下载次数限制', () => {
  it('max_downloads=1 只允许一次公开下载', async () => {
    const a = await createKey('limit-1');
    const up = await uploadFile(a.apiKey, 'once', 'once.txt', '?max_downloads=1');
    expect(await respStatus(await SELF.fetch(up.url))).toBe(200);
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    expect(await respStatus(await SELF.fetch(up.url))).toBe(410);
  });

  it('max_downloads=N 允许 N 次', async () => {
    const a = await createKey('limit-2');
    const up = await uploadFile(a.apiKey, 'n', 'n.txt', '?max_downloads=3');
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(410);
  });

  it('不限制次数时可持续下载', async () => {
    const a = await createKey('limit-3');
    const up = await uploadFile(a.apiKey, 'unlimited', 'u.txt');
    for (let i = 0; i < 5; i++) {
      expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    }
  });

  it('并发争抢最后一次额度只有一个成功', async () => {
    const a = await createKey('limit-4');
    const up = await uploadFile(a.apiKey, 'race', 'race.txt', '?max_downloads=1');
    const downloadUrl = `${up.url}/file`;
    const statuses = await parallelStatus([downloadUrl, downloadUrl, downloadUrl]);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBe(1);
  });
});

describe('阅后即焚', () => {
  it('首次请求成功,第二次请求失败', async () => {
    const a = await createKey('burn-1');
    const up = await uploadFile(a.apiKey, 'secret', 's.txt', '?burn_after_read=true');
    expect(await respStatus(await SELF.fetch(up.url))).toBe(200);
    expect(await respStatus(await SELF.fetch(`${up.url}/file`))).toBe(200);
    const second = await SELF.fetch(`${up.url}/file`, { headers: { accept: 'application/json' } });
    const secondBody = (await second.json()) as any;
    expect(second.status).toBe(410);
    expect(secondBody.error.code).toBe('file_consumed');
  });

  it('burn_after_read 与 max_downloads>1 冲突被拒绝', async () => {
    const a = await createKey('burn-2');
    const up = await uploadFile(a.apiKey, 'x', 'x.txt', '?burn_after_read=true&max_downloads=3');
    expect(up.status).toBe(400);
  });

  it('并发访问阅后即焚文件最多一个成功', async () => {
    const a = await createKey('burn-3');
    const up = await uploadFile(a.apiKey, 'burn-race', 'b.txt', '?burn_after_read=true');
    const downloadUrl = `${up.url}/file`;
    const statuses = await parallelStatus([downloadUrl, downloadUrl, downloadUrl]);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBe(1);
  });
});

describe('过期', () => {
  it('已过期文件拒绝公开下载', async () => {
    const a = await createKey('expire-1');
    const up = await uploadFile(a.apiKey, 'tmp', 't.txt', '?expires_in=1');
    expect(up.status).toBe(200);
    // 手工将 expires_at 改为过去
    await env.DB.prepare('UPDATE files SET expires_at = ?').bind(Date.now() - 1000).run();
    const dl = await SELF.fetch(up.url, { headers: { accept: 'application/json' } });
    const dlBody = (await dl.json()) as any;
    expect(dl.status).toBe(410);
    expect(dlBody.error.code).toBe('file_expired');
  });
});
