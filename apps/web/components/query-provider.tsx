'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api/client';

function isClientError(err: unknown) {
  if (err instanceof ApiClientError) return !['INTERNAL', 'RATE_LIMITED'].includes(err.code);
  const status = (err as { status?: number; code?: string } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Retry twice with exponential backoff, never on 4xx.
        retry: (count, err) => !isClientError(err) && count < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
