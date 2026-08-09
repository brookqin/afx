/** 上传成功页面(§29):简洁提示,可关闭。 */

import type { FC } from 'hono/jsx';
import { messages, type Locale } from '../i18n';
import { Layout } from './layout';

interface SuccessPageProps {
  filename?: string;
  locale: Locale;
}

export const SuccessPage: FC<SuccessPageProps> = ({ filename, locale }) => {
  const copy = messages(locale);
  return (
    <Layout title={copy.successTitle} locale={locale}>
      <header class="card-header">
        <span class="eyebrow">{copy.successTitle}</span>
        <h1>{copy.successHeading}</h1>
        {filename ? <p class="lead">{copy.successReceived}: <strong>{filename}</strong></p> : null}
      </header>
      <footer class="card-footer">
        <p class="notice">{copy.successClose}</p>
      </footer>
    </Layout>
  );
};
