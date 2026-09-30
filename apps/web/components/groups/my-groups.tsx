'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronRight, Clock, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { SkeletonCard } from '@/components/skeletons';

export function MyGroups() {
  const t = useTranslations('groupsPage');
  const { data, isPending } = useQuery({
    queryKey: qk.me.groups(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('group_members')
        .select('status, groups(id, name, description)')
        .in('status', ['active', 'pending']);
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });

  if (isPending)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <SkeletonCard key={i} className="h-24" />
        ))}
      </div>
    );
  if (!data?.length)
    return <p className="text-muted-foreground bg-card rounded-lg border p-6">{t('empty')}</p>;
  return (
    // minmax(0,1fr): grid items must be allowed to shrink below their content, otherwise a long
    // group name (e.g. "BRGY. PINAGBAYANAN RESCUER") widens the column past the phone screen.
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
      {data.map((m) => {
        const g = m.groups as unknown as {
          id: string;
          name: string;
          description: string | null;
        } | null;
        if (!g) return null;
        const body = (
          <>
            <span className="bg-lake/15 text-lake flex size-12 shrink-0 items-center justify-center rounded-xl">
              <Users className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-bold break-words" title={g.name}>
                {g.name}
              </span>
              {m.status === 'pending' ? (
                <span className="text-signal-amber flex items-center gap-1 text-sm">
                  <Clock className="size-3.5" aria-hidden /> {t('pendingJoin')}
                </span>
              ) : (
                <span className="text-muted-foreground line-clamp-1 text-sm">{g.description}</span>
              )}
            </span>
            {m.status === 'active' && (
              <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
            )}
          </>
        );
        return (
          <li key={g.id} className="min-w-0">
            {m.status === 'active' ? (
              <Link
                href={`/groups/${g.id}`}
                className="bg-card hover:border-primary flex items-center gap-3 rounded-lg border p-4"
              >
                {body}
              </Link>
            ) : (
              <div className="bg-card flex items-center gap-3 rounded-lg border p-4 opacity-80">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
