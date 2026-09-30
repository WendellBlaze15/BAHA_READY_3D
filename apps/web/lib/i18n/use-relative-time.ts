'use client';

import { useCallback } from 'react';
import { useFormatter, useNow } from 'next-intl';

/**
 * "5 minutes ago" formatting that is hydration-safe and stays fresh.
 * `now` starts from the request time the server passed to NextIntlClientProvider (so server
 * and client render the same text), then ticks every minute on the client.
 */
export function useRelativeTime() {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return useCallback(
    (date: Date | string) => format.relativeTime(new Date(date), now),
    [format, now],
  );
}
