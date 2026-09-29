'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** Non-blocking offline notice. */
export function OfflineBanner() {
  const t = useTranslations('offline');
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="bg-storm-slate text-mist flex items-center justify-center gap-2 px-4 py-2 text-sm"
    >
      <WifiOff className="size-4" aria-hidden />
      {t('banner')}
    </div>
  );
}
