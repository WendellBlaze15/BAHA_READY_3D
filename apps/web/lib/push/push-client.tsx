'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { useMarkNotificationsRead, useSettings } from '@/lib/data/me';

const b64ToUint8 = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribe this browser to Web Push (called after the user enables push in Settings). */
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported' as const;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied' as const;
  const reg = await navigator.serviceWorker.ready;
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return 'unsupported' as const;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(key),
    }));
  await apiPost('/api/push/subscribe', { platform: 'web', subscription: sub.toJSON() });
  return 'enabled' as const;
}

/**
 * Keeps push in sync with the user's setting, prompts for app updates (SW waiting),
 * and marks a notification read when opened from a push (?n=<id>) — synced to all devices.
 */
export function PushAndUpdates() {
  const t = useTranslations('pwa');
  const { data: settings } = useSettings();
  const params = useSearchParams();
  const mark = useMarkNotificationsRead();
  const pushOn = (settings?.notifications as { push?: boolean } | undefined)?.push;

  useEffect(() => {
    const id = params.get('n');
    if (id && /^[0-9a-f-]{36}$/.test(id)) mark.mutate([id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (!pushOn || typeof Notification === 'undefined' || Notification.permission !== 'granted')
      return;
    void enablePush().catch(() => undefined); // refresh subscription silently
  }, [pushOn]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;
    const prompt = (reg: ServiceWorkerRegistration) => {
      if (cancelled || !reg.waiting || location.pathname.includes('/play/')) return;
      toast.info(t('updateAvailable'), {
        duration: Infinity,
        action: {
          label: t('reload'),
          onClick: () => {
            reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
              once: true,
            });
          },
        },
      });
    };
    void navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      prompt(reg);
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => prompt(reg));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return null;
}
