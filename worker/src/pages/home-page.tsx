import type { FC } from 'hono/jsx';
import { messages, type Locale } from '../i18n';
import { Layout } from './layout';

export const HomePage: FC<{ locale: Locale }> = ({ locale }) => {
  const copy = messages(locale);
  return (
    <Layout title="Agent File Exchange" locale={locale} wide>
      <section class="card-header">
        <span class="eyebrow">{copy.homeBadge}</span>
        <h1>Agent File Exchange</h1>
        <p class="lead">{copy.homeDescription}</p>
      </section>
      <div class="separator" />
      <section class="card-content">
        <div class="home-grid">
          <article class="feature">
            <strong class="feature-title">{copy.homeDirectTitle}</strong>
            <p class="feature-copy">{copy.homeDirectDescription}</p>
          </article>
          <article class="feature">
            <strong class="feature-title">{copy.homeInboxTitle}</strong>
            <p class="feature-copy">{copy.homeInboxDescription}</p>
          </article>
          <article class="feature">
            <strong class="feature-title">{copy.homeSecurityTitle}</strong>
            <p class="feature-copy">{copy.homeSecurityDescription}</p>
          </article>
        </div>
      </section>
      <footer class="card-footer home-footer">
        <p class="notice">{copy.homeAudience}</p>
        <a class="btn btn-secondary" href="https://github.com/brookqin/afx" rel="noreferrer">{copy.homeGithub}</a>
      </footer>
    </Layout>
  );
};
