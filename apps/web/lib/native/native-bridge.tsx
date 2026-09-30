'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Maps a deep link (App Link or bahaready://) to an in-app path; null if not ours. */
export function deepLinkToPath(raw: string, host = location.host): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === 'bahaready:') {
    // bahaready://join/ABC123 → host "join", path "/ABC123"
    const parts = [u.host, ...u.pathname.split('/')].filter(Boolean);
    if (parts[0] === 'join' && /^[A-Z2-9]{6}$/i.test(parts[1] ?? ''))
      return `/groups?code=${parts[1]!.toUpperCase()}`;
    const path = `/${parts.join('/')}${u.search}`;
    return /^\/[\w\-/]*(\?[\w=&%-]*)?$/.test(path) ? path : null;
  }
  if (u.protocol === 'https:' && u.host === host) return `${u.pathname}${u.search}`;
  return null;
}

/**
 * Inside the Capacitor Android shell only: routes deep links in-app and makes the hardware
 * back button navigate history (exiting from the root). No-op (and not loaded) on the web.
 */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    let off: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      const a = await App.addListener('appUrlOpen', ({ url }) => {
        const path = deepLinkToPath(url);
        if (path) router.push(path);
      });
      const b = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) history.back();
        else void App.exitApp();
      });
      off = () => {
        void a.remove();
        void b.remove();
      };
    });
    return () => off?.();
  }, [router]);

  return null;
}
