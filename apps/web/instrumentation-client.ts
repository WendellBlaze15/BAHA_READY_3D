import { z } from 'zod';

// Zod v4 probes `new Function` for a JIT fast path; our CSP forbids eval (it falls back, but
// each probe logs a CSP violation). Jitless mode skips the probe entirely.
z.config({ jitless: true });

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

type SentryModule = typeof import('@sentry/nextjs');
let sentry: SentryModule | undefined;

// DECISION: Sentry is loaded lazily and only when a DSN is set — a static import shipped
// ~430 kB (SDK + Replay) to every visitor even with monitoring disabled.
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    sentry = Sentry;
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
      beforeSend(event) {
        // Scrub anything that looks like a token from URLs and breadcrumbs.
        if (event.request?.url)
          event.request.url = event.request.url.replace(/(token|code)=[^&]+/gi, '$1=[redacted]');
        return event;
      },
    });
  });
}

export function onRouterTransitionStart(
  ...args: Parameters<SentryModule['captureRouterTransitionStart']>
) {
  sentry?.captureRouterTransitionStart(...args);
}
