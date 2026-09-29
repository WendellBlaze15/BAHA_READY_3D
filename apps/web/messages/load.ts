import type { Locale } from '@/i18n/routing';

/**
 * Messages are split per feature (messages/<locale>/<feature>.json) and merged here.
 * Top-level namespaces must be unique across files (enforced by messages.test.ts).
 */
export const FEATURE_FILES = ['app', 'game', 'social', 'staff'] as const;

export async function loadMessages(locale: Locale) {
  const parts = await Promise.all([
    import(`./${locale}.json`),
    ...FEATURE_FILES.map((f) => import(`./${locale}/${f}.json`)),
  ]);
  return Object.assign({}, ...parts.map((p) => p.default)) as Record<string, unknown>;
}
