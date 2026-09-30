'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { getPathname } from '@/i18n/navigation';

/**
 * Sign-in / sign-out must never show the previous user's data. Client-side navigation would
 * keep the in-memory TanStack Query cache and Next's router cache (both hold user A's
 * profile, settings, groups…), so we clear the query cache and do a full document load.
 */
export function useAuthTransition() {
  const qc = useQueryClient();
  const locale = useLocale();
  return useCallback(
    (path: string) => {
      qc.cancelQueries();
      qc.clear();
      const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/';
      // API `next` values are locale-less app paths; add the locale prefix (none for fil).
      const hasLocale = /^\/(en|fil)(\/|$)/.test(safe);
      window.location.replace(hasLocale ? safe : getPathname({ href: safe, locale }));
    },
    [qc, locale],
  );
}
