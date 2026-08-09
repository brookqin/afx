import type { FC } from 'hono/jsx';
import { messages, type Locale } from '../i18n';
import type { FileRow } from '../repositories/file-repository';
import { toIso } from '../util/time';
import { Layout } from './layout';

interface DownloadPageProps {
  file: FileRow;
  token: string;
  locale: Locale;
  publicBaseUrl: string;
}

function formatBytes(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: n >= 1024 * 1024 * 1024 ? 'gigabyte' : n >= 1024 * 1024 ? 'megabyte' : n >= 1024 ? 'kilobyte' : 'byte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(n >= 1024 * 1024 * 1024 ? n / 1024 / 1024 / 1024 : n >= 1024 * 1024 ? n / 1024 / 1024 : n >= 1024 ? n / 1024 : n);
}

export const DownloadPage: FC<DownloadPageProps> = ({ file, token, locale, publicBaseUrl }) => {
  const copy = messages(locale);
  const uploadedAt = toIso(file.ready_at ?? file.created_at)!;
  const downloadPath = `/d/${token}/file`;
  const downloadUrl = `${publicBaseUrl.replace(/\/$/, '')}${downloadPath}`;
  const metadata = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MediaObject',
    name: file.original_name,
    description: file.description ?? undefined,
    contentSize: String(file.size_bytes),
    encodingFormat: file.content_type ?? 'application/octet-stream',
    uploadDate: uploadedAt,
    expires: toIso(file.expires_at),
    contentUrl: downloadUrl,
  }).replace(/</g, '\\u003c');

  return (
    <Layout title={`${copy.downloadTitle} · ${file.original_name}`} locale={locale}>
      <article itemScope itemType="https://schema.org/MediaObject">
        <header class="card-header">
          <span class="eyebrow">{copy.downloadHeading}</span>
          <h1 itemProp="name">{file.original_name}</h1>
        </header>
        <div class="separator" />
        <section class="card-content">
          <dl class="metadata-list">
            <div class="metadata-row">
              <dt>{copy.downloadFilename}</dt>
              <dd itemProp="name">{file.original_name}</dd>
            </div>
            <div class="metadata-row">
              <dt>{copy.downloadUploadedAt}</dt>
              <dd><time itemProp="uploadDate" dateTime={uploadedAt} data-local-date>{uploadedAt}</time></dd>
            </div>
            <div class="metadata-row">
              <dt>{copy.downloadSize}</dt>
              <dd><data itemProp="contentSize" value={String(file.size_bytes)}>{formatBytes(file.size_bytes, locale)}</data></dd>
            </div>
            {file.description ? <div class="metadata-row"><dt>{copy.downloadDescription}</dt><dd class="description" itemProp="description">{file.description}</dd></div> : null}
          </dl>
        </section>
        <footer class="card-footer">
          <div class="actions actions-compact">
            <a class="btn" href={downloadPath} itemProp="contentUrl" download>{copy.downloadButton}</a>
          </div>
          <p class="notice notice-spaced">{copy.downloadNotice}</p>
        </footer>
      </article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: metadata }} />
    </Layout>
  );
};
