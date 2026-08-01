/** 页面基础布局:极简卡片风格,无导航栏、无账户入口(§29)。 */

import type { FC, PropsWithChildren } from 'hono/jsx';
import type { Locale } from '../i18n';

export const Layout: FC<PropsWithChildren<{ title: string; locale: Locale }>> = ({ title, locale, children }) => {
  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main class="card">{children}</main>
      </body>
    </html>
  );
};

const css = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4f5f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1f2329;
  }
  .card {
    width: min(560px, calc(100vw - 32px));
    background: #fff;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 4px 20px rgba(0,0,0,.06);
  }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #5f6368; line-height: 1.6; margin: 6px 0; }
  .meta { font-size: 13px; color: #8a9099; margin-top: 12px; }
  .btn {
    display: inline-block;
    background: #1a73e8;
    color: #fff;
    border: 0;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 15px;
    cursor: pointer;
  }
  .btn:disabled { background: #a8c7f5; cursor: not-allowed; }
  .file-row { display: flex; gap: 10px; align-items: center; margin: 16px 0; }
  .file-name { font-size: 14px; color: #333; }
  .bar { height: 6px; background: #e8eaed; border-radius: 3px; overflow: hidden; margin-top: 12px; }
  .bar > div { height: 100%; width: 0; background: #1a73e8; transition: width .2s; }
  .ok { color: #188038; }
  .err { color: #c5221f; }
  .status { font-size: 14px; margin-top: 10px; }
  .muted { color: #8a9099; }
  .locale { float: right; font-size: 13px; }
  .locale a { color: #5f6368; text-decoration: none; }
  .locale a[aria-current="page"] { color: #1a73e8; font-weight: 600; }
`;
