'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { flushPendingSubmissions, migrateGuestProgress } from '@/lib/game/attempt-api';
import { qk } from '@/lib/query-keys';

/**
 * Signed-in background sync: flushes queued offline submissions (on start, on reconnect,
 * every 60s) and imports guest progress once after sign-up.
 */
export function OfflineSync() {
  const qc = useQueryClient();
  const t = useTranslations('offline');

  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      const saved = await flushPendingSubmissions().catch(() => 0);
      if (!cancelled && saved > 0) {
        toast.success(t('synced', { count: saved }));
        void qc.invalidateQueries({ queryKey: qk.me.all() });
        void qc.invalidateQueries({ queryKey: qk.leaderboard.all() });
      }
    };
    void (async () => {
      try {
        const migrated = await migrateGuestProgress();
        if (migrated && !cancelled) {
          toast.success(t('guestMigrated'));
          void qc.invalidateQueries({ queryKey: qk.me.all() });
        }
      } catch {
        // retried on next load
      }
      await flush();
    })();
    window.addEventListener('online', flush);
    const id = window.setInterval(flush, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener('online', flush);
      window.clearInterval(id);
    };
  }, [qc, t]);

  return null;
}
