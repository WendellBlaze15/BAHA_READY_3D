import { defineRouting } from 'next-intl/routing';

export const locales = ['fil', 'en'] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'fil',
  // DECISION: 'as-needed' keeps Filipino URLs clean (/levels) while English gets /en/levels.
  localePrefix: 'as-needed',
  localeCookie: { name: 'NEXT_LOCALE', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' },
});
