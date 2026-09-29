'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiClientError } from '@/lib/api/client';

/** Translate an API error (message keys like `errors.otp_invalid`) into user-facing text. */
export function useApiErrorText() {
  const t = useTranslations();
  return useCallback(
    (err: unknown, fallbackKey = 'errors.generic') => {
      if (err instanceof ApiClientError) {
        const key = err.messageKey || fallbackKey;
        const seconds = err.retryAfter ?? 60;
        try {
          return (t as (k: string, v?: Record<string, number>) => string)(key, { seconds });
        } catch {
          return t(fallbackKey as never);
        }
      }
      return t(fallbackKey as never);
    },
    [t],
  );
}

/** Translate a field-level key, falling back to the raw key if missing. */
export function useFieldErrorText() {
  const t = useTranslations();
  return useCallback(
    (key?: string) => {
      if (!key) return undefined;
      try {
        return t(key as never);
      } catch {
        return t('errors.validation');
      }
    },
    [t],
  );
}
