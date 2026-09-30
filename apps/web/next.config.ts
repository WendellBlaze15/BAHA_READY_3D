import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs/config';
import withSerwistInit from '@serwist/next';

// DECISION: secrets live in the repo-root .env.local (single source of truth for the app,
// scripts, and CLI tooling). On Vercel the dashboard env vars are used instead.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Metadata is cheap (local translations): always render it in <head> for every UA, so
  // link previews and SEO tools that aren't on Next's bot list still see it.
  htmlLimitedBots: /.*/,
  transpilePackages: ['@baha/shared'],
  images: { formats: ['image/avif', 'image/webp'] },
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion', 'radix-ui'],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // The QR scanner is the only route allowed to use the camera.
        source: '/:locale(en)?/groups',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(self)' }],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
// Serwist builds the service worker for production only (Turbopack dev doesn't support it).
const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: false,
  reloadOnOnline: false,
  disable: process.env.NODE_ENV !== 'production',
  additionalPrecacheEntries: [
    { url: '/offline', revision: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  ],
});
const config = withSerwist(withNextIntl(nextConfig));

export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
    })
  : config;
