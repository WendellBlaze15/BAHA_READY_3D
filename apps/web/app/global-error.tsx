'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fil">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <main className="max-w-md space-y-4">
          <h1 className="text-3xl font-bold">May nangyaring mali · Something went wrong</h1>
          <p>Na-report na namin ito. / We&apos;ve reported it.</p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground min-h-11 rounded-sm px-4"
          >
            Subukan ulit / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
