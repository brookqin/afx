/**
 * 一次性上传页面(/u/:token)。只展示邀请信息与上传表单。
 * 不展示:API Key 名称、owner_key_id、Agent 身份、内部文件 ID、R2 Object Key。
 */

import type { FC } from 'hono/jsx';
import { localeQuery, messages, type Locale } from '../i18n';
import type { InboxRow } from '../repositories/inbox-repository';
import { MAX_FILE_DESCRIPTION_LENGTH } from '../schemas/upload';
import { Layout } from './layout';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GiB';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MiB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB';
  return String(n) + ' B';
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
      <header class="card-header">
        <span class="eyebrow">{copy.uploadEyebrow}</span>
        <h1>{inbox.title || copy.uploadDefaultTitle}</h1>
        {inbox.description ? <p class="lead">{inbox.description}</p> : null}
      </header>
      <div class="separator" />
      <section class="card-content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">{copy.maxFileSize}</span>
            <span class="meta-value">{formatBytes(inbox.max_file_size_bytes)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">{copy.deadline}</span>
            <time class="meta-value" dateTime={new Date(inbox.expires_at).toISOString()} data-local-date>{new Date(inbox.expires_at).toISOString()}</time>
          </div>
        </div>
        {hint ? <p class="hint">{hint}</p> : null}

        <form id="upload-form" data-base={`/u/${token}`} data-lang={localeQuery(locale)}>
          <div class="field">
            <span class="field-label">{copy.chooseFile}</span>
            <div class="file-row">
              <input class="file-input" type="file" name="file" id="file-input" required />
              <label class="file-picker" for="file-input">{copy.chooseFile}</label>
              <span class="file-name" id="file-name">{copy.noFileSelected}</span>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="file-description">
              <span>{copy.fileDescription}</span>
              <span class="field-hint">{copy.fileDescriptionHint}</span>
            </label>
            <textarea
              id="file-description"
              name="description"
              maxlength={MAX_FILE_DESCRIPTION_LENGTH}
              rows={4}
            />
          </div>
          <div class="actions">
            <button type="submit" class="btn" id="submit-btn">{copy.uploadButton}</button>
          </div>
          <div class="bar" id="bar" hidden>
            <div id="bar-fill" />
          </div>
          <p class="status" id="status" role="status" />
        </form>
      </section>

      <script dangerouslySetInnerHTML={{ __html: buildUploadScript(copy.uploadClient, copy.errors, copy.noFileSelected) }} />
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

function buildUploadScript(
  copy: ReturnType<typeof messages>['uploadClient'],
  errors: ReturnType<typeof messages>['errors'],
  noFileSelected: string,
): string {
  const serialized = JSON.stringify({
    ...copy,
    noFileSelected,
    errorMessages: Object.fromEntries(Object.entries(errors).map(([code, value]) => [code, value.message])),
  }).replace(/</g, '\\u003c');
  return `
(function () {
  var copy = ${serialized};
  var form = document.getElementById('upload-form');
  var fileInput = document.getElementById('file-input');
  var fileName = document.getElementById('file-name');
  var submitBtn = document.getElementById('submit-btn');
  var descriptionInput = document.getElementById('file-description');
  var status = document.getElementById('status');
  var bar = document.getElementById('bar');
  var fill = document.getElementById('bar-fill');
  if (!form) return;
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileName.textContent = file ? file.name : copy.noFileSelected;
  });
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
        body: JSON.stringify({
          filename: file.name,
          size_bytes: file.size,
          content_type: file.type || null,
          description: descriptionInput.value.trim() || null
        })
      });
      var initBody = await initRes.json();
      if (!initRes.ok || !initBody.ok) {
        var errorCode = initBody.error && initBody.error.code;
        throw new Error(copy.errorMessages[errorCode] || copy.initiateFailed);
      }

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
