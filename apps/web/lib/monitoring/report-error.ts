/**
 * Client error reporting. Sentry (~400 kB with Replay) is only downloaded when a DSN is
 * configured and an error actually happens, so it never weighs on first load.
 */
export function reportError(error: unknown) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import('@sentry/nextjs').then((S) => S.captureException(error));
}
