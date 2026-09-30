'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';

/** The signed-in user's latest facilitator application (RLS: own rows only). */
export function useMyApplication() {
  return useQuery({
    queryKey: qk.me.application(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('facilitator_applications')
        .select('id, status, review_note, created_at, organization')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
}

/** Home banner while a facilitator registration awaits admin approval (updates live). */
export function ApplicationBanner() {
  const t = useTranslations('apply');
  const { data } = useMyApplication();
  if (data?.status !== 'pending') return null;
  return (
    <section
      aria-live="polite"
      className="border-signal-amber/60 bg-signal-amber/10 flex flex-wrap items-start gap-3 rounded-xl border p-4"
    >
      <Clock className="text-signal-amber mt-0.5 size-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-bold">{t('bannerTitle')}</p>
        <p className="text-muted-foreground text-sm">{t('bannerBody')}</p>
      </div>
      <Link
        href="/apply"
        className="bg-card hover:bg-accent inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-bold"
      >
        {t('bannerLink')}
      </Link>
    </section>
  );
}
