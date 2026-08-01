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
      <h1 class="ok">{copy.successHeading}</h1>
      {filename ? <p>{copy.successReceived}: {filename}</p> : null}
      <p>{copy.successClose}</p>
    </Layout>
  );
};
