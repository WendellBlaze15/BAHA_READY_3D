import * as Sentry from '@sentry/nextjs';

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
    beforeSend(event) {
      // Scrub anything that looks like a token from URLs and breadcrumbs.
      if (event.request?.url)
        event.request.url = event.request.url.replace(/(token|code)=[^&]+/gi, '$1=[redacted]');
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
