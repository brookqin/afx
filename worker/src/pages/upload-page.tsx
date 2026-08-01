/**
 * 一次性上传页面(/u/:token)。只展示邀请信息与上传表单。
 * 不展示:API Key 名称、owner_key_id、Agent 身份、内部文件 ID、R2 Object Key。
 */

import type { FC } from 'hono/jsx';
import { localeQuery, messages, type Locale } from '../i18n';
import type { InboxRow } from '../repositories/inbox-repository';
import { Layout } from './layout';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GiB';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MiB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB';
  return String(n) + ' B';
}

function formatDate(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, { hour12: false });
}

interface UploadPageProps {
  inbox: InboxRow;
  token: string;
  locale: Locale;
}

export const UploadPage: FC<UploadPageProps> = ({ inbox, token, locale }) => {
  const copy = messages(locale);
  const exts = safeArray(inbox.allowed_extensions_json);
  const types = safeArray(inbox.allowed_content_types_json);
  const hint = [
    exts.length ? `${copy.allowedExtensions}: ${exts.join(' ')}` : '',
    types.length ? `${copy.allowedTypes}: ${types.join(' ')}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Layout title={inbox.title || copy.uploadDefaultTitle} locale={locale}>
      <nav class="locale" aria-label="Language">
        <a href={`?lang=${localeQuery('zh-CN')}`} aria-current={locale === 'zh-CN' ? 'page' : undefined}>中文</a>
        <span> / </span>
        <a href={`?lang=${localeQuery('en')}`} aria-current={locale === 'en' ? 'page' : undefined}>EN</a>
      </nav>
      <h1>{inbox.title || copy.uploadDefaultTitle}</h1>
      {inbox.description ? <p>{inbox.description}</p> : null}
      <p class="meta">
        {copy.maxFileSize}: {formatBytes(inbox.max_file_size_bytes)}
        {hint ? <span> · {hint}</span> : null}
      </p>
      <p class="meta">{copy.deadline}: {formatDate(inbox.expires_at, locale)}</p>

      <form id="upload-form" data-base={`/u/${token}`} data-lang={localeQuery(locale)}>
        <div class="file-row">
          <input type="file" name="file" id="file-input" required />
        </div>
        <button type="submit" class="btn" id="submit-btn">{copy.uploadButton}</button>
        <div class="bar" id="bar" hidden>
          <div id="bar-fill" />
        </div>
        <p class="status" id="status" role="status" />
      </form>

      <script dangerouslySetInnerHTML={{ __html: buildUploadScript(copy.uploadClient) }} />
    </Layout>
  );
};

function safeArray(json: string): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function buildUploadScript(copy: ReturnType<typeof messages>['uploadClient']): string {
  const serialized = JSON.stringify(copy).replace(/</g, '\\u003c');
  return `
(function () {
  var copy = ${serialized};
  var form = document.getElementById('upload-form');
  var fileInput = document.getElementById('file-input');
  var submitBtn = document.getElementById('submit-btn');
  var status = document.getElementById('status');
  var bar = document.getElementById('bar');
  var fill = document.getElementById('bar-fill');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    submitBtn.disabled = true;
    status.className = 'status muted';
    status.textContent = copy.creating;
    bar.hidden = false;
    try {
      var base = form.getAttribute('data-base');
      var lang = encodeURIComponent(form.getAttribute('data-lang') || 'zh-CN');
      var initRes = await fetch(base + '/initiate?lang=' + lang, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ filename: file.name, size_bytes: file.size, content_type: file.type || null })
      });
      var initBody = await initRes.json();
      if (!initRes.ok || !initBody.ok) throw new Error(initBody.error && initBody.error.message || copy.initiateFailed);

      status.textContent = copy.uploading;
      await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(initBody.data.upload_method, initBody.data.upload_url, true);
        var headers = initBody.data.upload_headers || {};
        Object.keys(headers).forEach(function (name) { xhr.setRequestHeader(name, headers[name]); });
        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable) fill.style.width = Math.round(ev.loaded / ev.total * 100) + '%';
        };
        xhr.onload = function () { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(copy.storageHttp + xhr.status)); };
        xhr.onerror = function () { reject(new Error(copy.corsFailed)); };
        xhr.send(file);
      });

      status.textContent = copy.confirming;
      var completeRes = await fetch(base + '/complete?lang=' + lang, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
        body: JSON.stringify({ file_id: initBody.data.file_id, upload_id: initBody.data.upload_id })
      });
      var html = await completeRes.text();
      document.open(); document.write(html); document.close();
    } catch (err) {
      status.className = 'status err';
      status.textContent = copy.failedPrefix + (err && err.message ? err.message : copy.retry);
      submitBtn.disabled = false;
      bar.hidden = true;
    }
  });
})();
`;
}
