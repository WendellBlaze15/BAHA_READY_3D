'use client';

import { useTranslations } from 'next-intl';
import { Plus, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/** Empty state for facilitator tools that need a group (analytics, live, reports). */
export function NoGroups() {
  const t = useTranslations('fac');
  return (
    <section className="bg-card flex flex-col items-start gap-3 rounded-lg border p-6 sm:flex-row sm:items-center">
      <Users className="text-lake size-10 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-lg font-bold">{t('noGroupsTitle')}</h2>
        <p className="text-muted-foreground text-sm">{t('noGroupsBody')}</p>
      </div>
      <Link
        href="/facilitator/groups"
        className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 inline-flex min-h-11 items-center gap-2 rounded-lg px-4 font-bold"
      >
        <Plus className="size-4" aria-hidden /> {t('create')}
      </Link>
    </section>
  );
}
