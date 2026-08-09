/** 公共页面共享布局：shadcn 风格的中性色、细边框和紧凑层级。 */

import type { FC, PropsWithChildren } from 'hono/jsx';
import packageMetadata from '../../package.json';
import { localeQuery, messages, type Locale } from '../i18n';

interface LayoutProps {
  title: string;
  locale: Locale;
  wide?: boolean;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ title, locale, wide = false, children }) => {
  const copy = messages(locale);
  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <div class={`page-shell${wide ? ' page-shell-wide' : ''}`}>
          <header class="site-header">
            <a class="brand" href="/" aria-label="Agent File Exchange">AFX</a>
            <nav class="locale" aria-label={copy.languageLabel}>
              <a href={`?lang=${localeQuery('zh-CN')}`} aria-current={locale === 'zh-CN' ? 'page' : undefined}>中文</a>
              <a href={`?lang=${localeQuery('en')}`} aria-current={locale === 'en' ? 'page' : undefined}>EN</a>
            </nav>
          </header>
          <main class="card">{children}</main>
          <p class="site-footnote">Agent File Exchange v{packageMetadata.version}</p>
        </div>
        <script dangerouslySetInnerHTML={{ __html: localDateScript }} />
      </body>
    </html>
  );
};

const css = `
  :root {
    color-scheme: light;
    --background: #fafafa;
    --foreground: #09090b;
    --card: #ffffff;
    --muted: #f4f4f5;
    --muted-foreground: #71717a;
    --border: #e4e4e7;
    --input: #d4d4d8;
    --destructive: #dc2626;
    --success: #15803d;
    --ring: #a1a1aa;
    --radius: 12px;
  }
  * { box-sizing: border-box; }
  html { background: var(--background); }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--background);
    color: var(--foreground);
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .page-shell {
    width: min(640px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 32px 0 24px;
  }
  .page-shell-wide { width: min(760px, calc(100vw - 32px)); }
  .site-header {
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    color: var(--foreground);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -.01em;
    text-decoration: none;
  }
  .locale {
    display: inline-flex;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--card);
  }
  .locale a {
    min-width: 42px;
    padding: 5px 9px;
    border-radius: 6px;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.25;
    text-align: center;
    text-decoration: none;
  }
  .locale a:hover { color: var(--foreground); }
  .locale a[aria-current="page"] { background: var(--muted); color: var(--foreground); }
  .card {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: 0 1px 2px rgba(0, 0, 0, .025);
  }
  .card-header { padding: 28px 28px 20px; }
  .card-content { padding: 0 28px 28px; }
  .card-footer {
    padding: 20px 28px;
    border-top: 1px solid var(--border);
    background: #fcfcfc;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    margin-bottom: 12px;
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--card);
    color: #3f3f46;
    font-size: 12px;
    font-weight: 500;
  }
  h1 {
    margin: 0;
    font-size: clamp(22px, 4vw, 28px);
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: -.025em;
  }
  .lead { max-width: 58ch; margin: 10px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.65; }
  p { margin: 0; }
  .separator { height: 1px; margin: 0 28px 24px; background: var(--border); }
  .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
  .meta-item { min-width: 0; padding: 13px 14px; border: 1px solid var(--border); border-radius: 9px; background: #fcfcfc; }
  .meta-label { display: block; margin-bottom: 4px; color: var(--muted-foreground); font-size: 12px; font-weight: 500; }
  .meta-value { display: block; color: var(--foreground); font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
  .hint { margin: -12px 0 22px; color: var(--muted-foreground); font-size: 12px; }
  .field { margin-top: 18px; }
  .field:first-child { margin-top: 0; }
  .field-label { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
  .field-hint { color: var(--muted-foreground); font-size: 12px; font-weight: 400; }
  .file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 72px;
    padding: 14px;
    border: 1px dashed var(--input);
    border-radius: 9px;
    background: #fcfcfc;
  }
  .file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
  .file-picker {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    margin: 0;
    padding: 8px 13px;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 1px 1px rgba(0, 0, 0, .03);
  }
  .file-picker:hover { background: var(--muted); }
  .file-input:focus-visible + .file-picker { outline: 2px solid var(--ring); outline-offset: 2px; }
  .file-name { min-width: 0; color: var(--muted-foreground); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    width: 100%;
    min-height: 112px;
    padding: 10px 12px;
    resize: vertical;
    border: 1px solid var(--input);
    border-radius: 8px;
    background: var(--card);
    color: var(--foreground);
    font: inherit;
    line-height: 1.5;
    box-shadow: 0 1px 1px rgba(0, 0, 0, .02);
  }
  textarea::placeholder { color: #a1a1aa; }
  textarea:focus { outline: 2px solid var(--ring); outline-offset: 2px; border-color: #a1a1aa; }
  .actions { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
  .actions-compact { margin-top: 0; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    padding: 8px 16px;
    border: 1px solid #18181b;
    border-radius: 8px;
    background: #18181b;
    color: #fafafa;
    cursor: pointer;
    font-size: 13px;
    font-weight: 550;
    line-height: 1.25;
    text-decoration: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .08);
  }
  .btn:hover { background: #27272a; }
  .btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .btn:disabled { border-color: #d4d4d8; background: #d4d4d8; color: #71717a; cursor: not-allowed; box-shadow: none; }
  .btn-secondary { border-color: var(--input); background: var(--card); color: var(--foreground); box-shadow: 0 1px 1px rgba(0,0,0,.03); }
  .btn-secondary:hover { background: var(--muted); }
  .bar { height: 4px; overflow: hidden; margin-top: 18px; border-radius: 999px; background: var(--muted); }
  .bar > div { width: 0; height: 100%; border-radius: inherit; background: var(--foreground); transition: width .2s; }
  .status { margin-top: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #fcfcfc; color: var(--muted-foreground); font-size: 13px; }
  .status:empty { display: none; }
  .status.err { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
  .status.ok { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
  .metadata-list { margin: 0; }
  .metadata-row { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 20px; padding: 14px 0; border-top: 1px solid var(--border); }
  .metadata-row:first-child { border-top: 0; padding-top: 0; }
  .metadata-row:last-child { padding-bottom: 0; }
  dt { color: var(--muted-foreground); font-size: 12px; font-weight: 500; }
  dd { margin: 0; color: var(--foreground); font-size: 13px; overflow-wrap: anywhere; }
  .description { white-space: pre-wrap; line-height: 1.65; }
  .notice { color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
  .notice-spaced { margin-top: 12px; }
  .home-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .feature { padding: 16px; border: 1px solid var(--border); border-radius: 9px; background: #fcfcfc; }
  .feature-title { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }
  .feature-copy { color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
  .home-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .home-footer .notice { max-width: 46ch; }
  .site-footnote { margin-top: 14px; color: #a1a1aa; font-size: 11px; text-align: center; }
  @media (max-width: 640px) {
    .page-shell, .page-shell-wide { width: min(100% - 24px, 640px); padding-top: 16px; }
    .site-header { margin-bottom: 12px; }
    .card-header { padding: 22px 20px 18px; }
    .card-content { padding: 0 20px 22px; }
    .card-footer { padding: 18px 20px; }
    .separator { margin: 0 20px 20px; }
    .meta-grid, .home-grid { grid-template-columns: 1fr; }
    .metadata-row { grid-template-columns: 1fr; gap: 5px; }
    .home-footer { align-items: flex-start; flex-direction: column; }
    .file-row { align-items: flex-start; flex-direction: column; }
    .file-name { max-width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
  }
`;

const localDateScript = `
(function () {
  var locale = document.documentElement.lang || undefined;
  var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var formatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'longOffset'
  });
  document.querySelectorAll('time[data-local-date]').forEach(function (node) {
    var value = node.getAttribute('datetime');
    var date = value && new Date(value);
    if (date && !Number.isNaN(date.getTime())) {
      node.textContent = formatter.format(date) + (zone ? ' (' + zone + ')' : '');
    }
  });
})();
`;
