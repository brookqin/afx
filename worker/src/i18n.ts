import type { Context } from 'hono';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import type { MessageCatalog } from './locales/types';

export type Locale = 'en' | 'zh-CN';

const CATALOGS: Record<Locale, MessageCatalog> = { en, 'zh-CN': zhCN };

export function messages(locale: Locale): MessageCatalog {
  return CATALOGS[locale];
}

export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace('_', '-');
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return null;
}

export function resolveLocale(c: Context): Locale {
  const explicit = parseLocale(c.req.query('lang'));
  if (explicit) return explicit;

  const accepted = (c.req.header('accept-language') ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { locale: parseLocale(tag), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((item): item is { locale: Locale; q: number; index: number } => item.locale != null && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return accepted[0]?.locale ?? 'zh-CN';
}

export function localeQuery(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en';
}
