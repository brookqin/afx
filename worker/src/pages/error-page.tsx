/**
 * 公共错误页面(§16.6 / §29)。
 * 浏览器请求返回简洁 HTML;Accept: application/json 的请求返回统一 JSON 错误。
 */

import type { FC } from 'hono/jsx';
import type { ApiError } from '../errors';
import { messages, type Locale } from '../i18n';
import { Layout } from './layout';

export function errorCopy(err: ApiError, locale: Locale): { title: string; message: string } {
  const catalog = messages(locale);
  return catalog.errors[err.code] ?? { title: catalog.genericErrorTitle, message: err.message };
}

export const ErrorPage: FC<{ error: ApiError; locale: Locale }> = ({ error, locale }) => {
  const copy = errorCopy(error, locale);
  return (
    <Layout title={copy.title} locale={locale}>
      <h1>{copy.title}</h1>
      <p>{copy.message}</p>
    </Layout>
  );
};
