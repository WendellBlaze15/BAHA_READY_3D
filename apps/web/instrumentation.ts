import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail fast at boot if required server env vars are missing (names only, never values).
    const { serverEnv } = await import('./lib/env/server');
    serverEnv();
  }

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      // Privacy (RA 10173): never collect user info, cookies, headers, bodies, or query params.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
      environment: process.env.VERCEL_ENV ?? 'development',
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
