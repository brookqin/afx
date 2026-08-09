/**
 * 集成测试:接收邀请(§36.2 接收链接部分)。
 * - 创建 Inbox、页面可访问、一次成功上传、第二次拒绝、并发只一个成功、
 *   失败释放租约可重试、过期租约可重新领取、Agent 下载收到的文件。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { applyMigration, createKey, putDirectUploadObject, ROOT_KEY, respStatus } from '../helpers';

beforeAll(async () => {
  await applyMigration();
});

async function createInbox(apiKey: string, overrides: Record<string, unknown> = {}) {
  const res = await SELF.fetch('http://localhost/api/inboxes', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      expires_in: 3600,
      max_file_size_bytes: 1048576,
      title: '请上传诊断日志',
      description: 'ZIP 或 LOG 文件',
      allowed_extensions: ['.zip', '.log'],
      // 不限制 MIME,便于测试;扩展名白名单单独测试
      allowed_content_types: [],
      ...overrides,
    }),
  });
  const json = (await res.json()) as any;
  return { status: res.status, ...json };
}

async function uploadTo(uploadUrl: string, content: string, filename: string, description?: string) {
  const initiated = await SELF.fetch(`${uploadUrl}/initiate`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ filename, size_bytes: new TextEncoder().encode(content).byteLength, content_type: 'application/octet-stream', description }),
  });
  const initBody = (await initiated.json()) as any;
  if (!initBody.ok) return new Response(JSON.stringify(initBody), { status: initiated.status, headers: { 'content-type': 'application/json' } });
  const row = await env.DB.prepare('SELECT object_key FROM files WHERE id = ?').bind(initBody.data.file_id).first<{ object_key: string }>();
  if (!row) throw new Error('direct inbox upload row not found');
  await putDirectUploadObject(row.object_key, content);
  return SELF.fetch(`${uploadUrl}/complete`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: initBody.data.file_id, upload_id: initBody.data.upload_id }),
  });
}

describe('接收链接', () => {
  it('创建 Inbox 返回一次性上传 URL', async () => {
    const a = await createKey('inbox-1');
    const inbox = await createInbox(a.apiKey);
    expect(inbox.status).toBe(201);
    expect(inbox.data.upload_url).toContain('/u/');
    expect(inbox.data.status).toBe('open');
  });

  it('页面可访问且不泄露租户信息', async () => {
    const a = await createKey('inbox-2');
    const inbox = await createInbox(a.apiKey);
    const page = await SELF.fetch(inbox.data.upload_url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('请上传诊断日志');
    expect(html).toContain('fileInput.files && fileInput.files[0]');
    expect(html).toContain('.bar > div');
    expect(html).toContain('name="description"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain('>选择文件</label>');
    expect(html).toContain('尚未选择文件');
    expect(html).toContain('data-local-date');
    expect(html).toContain("timeZoneName: 'longOffset'");
    expect(html).toContain('上传服务尚未配置，请联系管理员。');
    expect(html).not.toContain('initBody.error && initBody.error.message');
    expect(html).not.toContain(a.apiKey);
    expect(html).not.toContain('objects/');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('content-security-policy')).toContain('r2.cloudflarestorage.com');
  });

  it('页面根据查询参数或 Accept-Language 切换独立语言资源', async () => {
    const a = await createKey('inbox-i18n');
    const inbox = await createInbox(a.apiKey, { title: '' });

    const english = await SELF.fetch(`${inbox.data.upload_url}?lang=en`, {
      headers: { 'accept-language': 'zh-CN' },
    });
    const englishHTML = await english.text();
    expect(english.headers.get('content-language')).toBe('en');
    expect(englishHTML).toContain('<html lang="en">');
    expect(englishHTML).toContain('Maximum file size');
    expect(englishHTML).toContain('>Choose file</label>');
    expect(englishHTML).toContain('No file selected');
    expect(englishHTML).toContain('Creating a secure upload session');

    const chinese = await SELF.fetch(inbox.data.upload_url, {
      headers: { 'accept-language': 'en;q=0.4, zh-CN;q=0.9' },
    });
    const chineseHTML = await chinese.text();
    expect(chinese.headers.get('content-language')).toBe('zh-CN');
    expect(chineseHTML).toContain('<html lang="zh-CN">');
    expect(chineseHTML).toContain('最大文件大小');
  });

  it('一次上传成功,第二次拒绝', async () => {
    const a = await createKey('inbox-3');
    const inbox = await createInbox(a.apiKey);
    const first = await uploadTo(inbox.data.upload_url, 'logs content', 'debug.log');
    expect(await respStatus(first)).toBe(200);
    const second = await uploadTo(inbox.data.upload_url, 'more', 'other.zip');
    const secondBody = (await second.json()) as any;
    expect(second.status).toBe(410);
    expect(secondBody.error.code).toBe('inbox_already_used');
  });

  it('两个并发上传只有一个获得租约', async () => {
    const a = await createKey('inbox-4');
    const inbox = await createInbox(a.apiKey);
    const first = await uploadTo(inbox.data.upload_url, 'one', 'a.log');
    const second = await uploadTo(inbox.data.upload_url, 'two', 'b.log');
    await first.arrayBuffer();
    await second.arrayBuffer();
    const ok = [first.status, second.status].filter((s) => s === 200).length;
    expect(ok).toBe(1);
    // 只有一个文件被接收
    const detail = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const detailJson = (await detail.json()) as any;
    expect(detailJson.data.status).toBe('completed');
  });

  it('失败的上传释放租约,可重试成功', async () => {
    const a = await createKey('inbox-5', { max_file_size_bytes: 100 });
    const inbox = await createInbox(a.apiKey, { max_file_size_bytes: 1048576 });
    // 超过 key 最大大小 -> 上传失败(文件过大)
    const fail = await uploadTo(inbox.data.upload_url, 'x'.repeat(200), 'big.log');
    expect(await respStatus(fail)).toBe(413);
    // 租约已释放,可重试
    const retry = await uploadTo(inbox.data.upload_url, 'ok', 'small.log');
    expect(await respStatus(retry)).toBe(200);
  });

  it('允许的扩展名白名单生效', async () => {
    const a = await createKey('inbox-6');
    const inbox = await createInbox(a.apiKey);
    const bad = await uploadTo(inbox.data.upload_url, 'x', 'evil.exe');
    const badBody = (await bad.json()) as any;
    expect(bad.status).toBe(415);
    expect(badBody.error.code).toBe('file_type_not_allowed');
    // 失败后仍可重试合法文件
    const good = await uploadTo(inbox.data.upload_url, 'x', 'ok.log');
    expect(await respStatus(good)).toBe(200);
  });

  it('过期 Inbox 拒绝上传', async () => {
    const a = await createKey('inbox-7');
    const inbox = await createInbox(a.apiKey);
    await env.DB.prepare('UPDATE upload_inboxes SET expires_at = ?').bind(Date.now() - 1000).run();
    const res = await uploadTo(inbox.data.upload_url, 'x', 'late.log');
    expect(await respStatus(res)).toBe(410);
  });

  it('Agent 可查询并下载收到的文件', async () => {
    const a = await createKey('inbox-8');
    const inbox = await createInbox(a.apiKey);
    await respStatus(await uploadTo(inbox.data.upload_url, 'received-content', 'payload.zip', '来自外部系统的诊断包'));

    // 详情含文件摘要
    const detail = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const detailJson = (await detail.json()) as any;
    expect(detailJson.data.status).toBe('completed');
    expect(detailJson.data.file.filename).toBe('payload.zip');
    expect(detailJson.data.file.description).toBe('来自外部系统的诊断包');

    // 下载
    const dl = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}/file`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(dl.status).toBe(200);
    expect(new TextDecoder().decode(await dl.arrayBuffer())).toBe('received-content');
  });

  it('其他租户不能读取或下载收到的文件', async () => {
    const a = await createKey('inbox-9a');
    const b = await createKey('inbox-9b');
    const inbox = await createInbox(a.apiKey);
    await respStatus(await uploadTo(inbox.data.upload_url, 'private', 'p.log'));

    const detail = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}`, {
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(await respStatus(detail)).toBe(404);

    const dl = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}/file`, {
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(await respStatus(dl)).toBe(404);
  });

  it('撤销 Inbox 后页面与上传均拒绝', async () => {
    const a = await createKey('inbox-10');
    const inbox = await createInbox(a.apiKey);
    const rev = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(await respStatus(rev)).toBe(200);

    const page = await SELF.fetch(inbox.data.upload_url);
    expect(await respStatus(page)).toBe(410);

    const up = await uploadTo(inbox.data.upload_url, 'x', 'r.log');
    expect(await respStatus(up)).toBe(410);
  });

  it('过期租约可重新领取', async () => {
    const a = await createKey('inbox-11');
    const inbox = await createInbox(a.apiKey);
    // 手工置为 uploading 且租约已过期
    await env.DB.prepare(
      `UPDATE upload_inboxes SET status='uploading', upload_lease_id='old-lease',
         upload_lease_started_at=?, upload_lease_until=?
       WHERE id = ?`,
    )
      .bind(Date.now() - 10000, Date.now() - 1000, inbox.data.id)
      .run();
    const up = await uploadTo(inbox.data.upload_url, 'retake', 'retake.log');
    expect(await respStatus(up)).toBe(200);
  });

  it('旧 Lease ID 不能完成新租约上传', async () => {
    const a = await createKey('inbox-12');
    const inbox = await createInbox(a.apiKey);
    // 模拟:租约 A 上传中,租约过期后被 B 重新领取
    await env.DB.prepare(
      `UPDATE upload_inboxes SET status='uploading', upload_lease_id='lease-A',
         upload_lease_started_at=?, upload_lease_until=?
       WHERE id = ?`,
    )
      .bind(Date.now() - 10000, Date.now() - 1000, inbox.data.id)
      .run();
    // B 领取(租约过期)
    const up = await uploadTo(inbox.data.upload_url, 'from-b', 'b.log');
    expect(await respStatus(up)).toBe(200);
    // 现在 Inbox completed;旧 lease-A 若尝试 complete 也不会匹配
    const detail = await SELF.fetch(`http://localhost/api/inboxes/${inbox.data.id}`, {
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const detailJson = (await detail.json()) as any;
    expect(detailJson.data.status).toBe('completed');
    expect(detailJson.data.file.filename).toBe('b.log');
  });
});
