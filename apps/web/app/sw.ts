/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const CONTENT_TABLES =
  /\/rest\/v1\/(tips|hotlines|gobag_items|home_tasks|hazards|npc_types|levels|level_versions|achievements)\b/;

/**
 * Caching strategy (Section 15.4):
 * - App shell, JS/CSS chunks (incl. the lazy 3D engine + Rapier WASM): precached / CacheFirst
 * - Public content API: StaleWhileRevalidate
 * - Auth, attempts, admin, all /api/*: NetworkOnly (never cached)
 * - DECISION: /play/* documents use NetworkFirst so a downloaded level can be replayed
 *   offline; they only contain level config + the viewer's avatar. Other documents are
 *   network-only with the offline page as fallback, so user data is never cached here.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }) =>
        url.hostname.endsWith('.supabase.co') &&
        /^\/(auth|functions|realtime|storage)\//.test(url.pathname),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, request }) =>
        request.method === 'GET' &&
        url.hostname.endsWith('.supabase.co') &&
        CONTENT_TABLES.test(url.pathname),
      handler: new StaleWhileRevalidate({
        cacheName: 'content-api',
        plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 86400 })],
      }),
    },
    {
      matcher: ({ url }) =>
        url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'),
      handler: new CacheFirst({
        cacheName: 'next-static',
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 86400 })],
      }),
    },
    {
      matcher: ({ request }) => ['image', 'font', 'audio'].includes(request.destination),
      handler: new CacheFirst({
        cacheName: 'assets',
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 })],
      }),
    },
    {
      matcher: ({ request, url }) =>
        request.mode === 'navigate' && /^(\/en)?\/play\//.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: 'play-pages',
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 12 })],
      }),
    },
    { matcher: ({ request }) => request.mode === 'navigate', handler: new NetworkOnly() },
  ],
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }],
  },
});

serwist.addEventListeners();

// ── Web Push ────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; href?: string; id?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Baha Ready', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.id,
      data: { href: data.href ?? '/notifications', id: data.id },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { href, id } = (event.notification.data ?? {}) as { href?: string; id?: string };
  const target = new URL(href ?? '/notifications', self.location.origin);
  if (id) target.searchParams.set('n', id); // marks it read on arrival (synced to all devices)
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
