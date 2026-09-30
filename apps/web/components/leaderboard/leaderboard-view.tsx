'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Crown, Radio, Star } from 'lucide-react';
import { qk } from '@/lib/query-keys';
import { useRealtimeStatus } from '@/lib/realtime/realtime-provider';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { SkeletonLeaderboardRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Row = {
  rank: number;
  user_id: string;
  username: string;
  avatar_config: Partial<AvatarConfig> | null;
  barangay: string | null;
  score: number;
  stars: number;
  is_me: boolean;
};
type Page = { rows: Row[]; me: Row | null; nextCursor: number | null };
type Scope = 'global' | 'level' | 'barangay' | 'group';
type Period = 'weekly' | 'all_time' | 'daily';

export function LeaderboardView({
  levels,
  groups,
  hasBarangay,
}: {
  levels: { id: number; name_fil: string; name_en: string }[];
  groups: { id: string; name: string }[];
  hasBarangay: boolean;
}) {
  const t = useTranslations('leaderboard');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const { connected } = useRealtimeStatus();
  const [scope, setScope] = useState<Scope>('global');
  const [period, setPeriod] = useState<Period>('weekly');
  const [level, setLevel] = useState<number>(
    levels.find((l) => l.id === 1)?.id ?? levels[0]?.id ?? 1,
  );
  const [group, setGroup] = useState<string | undefined>(groups[0]?.id);

  const blocked = (scope === 'barangay' && !hasBarangay) || (scope === 'group' && !group);
  const q = useInfiniteQuery({
    queryKey: qk.leaderboard.list(
      scope,
      period,
      scope === 'level' ? level : null,
      scope === 'group' ? group : null,
    ),
    enabled: !blocked,
    initialPageParam: 0,
    staleTime: 15_000,
    queryFn: async ({ pageParam }) => {
      const sp = new URLSearchParams({ scope, period, cursor: String(pageParam), limit: '20' });
      if (scope === 'level') sp.set('level', String(level));
      if (scope === 'group' && group) sp.set('group', group);
      const res = await fetch(`/api/leaderboard?${sp}`);
      const env = (await res.json()) as { data: Page | null };
      if (!res.ok || !env.data) throw new Error('leaderboard');
      return env.data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const me = q.data?.pages[0]?.me ?? null;
  const meVisible = rows.some((r) => r.is_me);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('title')} className="bg-muted flex rounded-lg p-1">
          {(['global', 'level', 'barangay', 'group'] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                'min-h-10 rounded-md px-3 text-sm font-bold',
                scope === s ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="h-11 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['weekly', 'all_time', 'daily'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`period.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === 'level' && (
          <Select value={String(level)} onValueChange={(v) => setLevel(Number(v))}>
            <SelectTrigger className="h-11 w-44" aria-label={t('chooseLevel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {locale === 'en' ? l.name_en : l.name_fil}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {scope === 'group' && groups.length > 0 && (
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="h-11 w-52" aria-label={t('chooseGroup')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {connected && (
          <span className="text-evac-green ml-auto flex items-center gap-1 text-xs font-bold">
            <Radio className="size-3.5 animate-pulse" aria-hidden /> {t('live')}
          </span>
        )}
      </div>

      <div className="bg-card overflow-hidden rounded-lg border">
        {blocked ? (
          <p className="text-muted-foreground p-6">
            {scope === 'barangay' ? t('noBarangay') : t('noGroup')}
          </p>
        ) : q.isPending ? (
          Array.from({ length: 8 }, (_, i) => <SkeletonLeaderboardRow key={i} />)
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6">{t('empty')}</p>
        ) : (
          <LayoutGroup>
            <ol>
              {rows.map((r) => (
                <motion.li
                  key={r.user_id}
                  layout={reduce ? false : 'position'}
                  transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <LbRow r={r} youLabel={t('you')} />
                </motion.li>
              ))}
            </ol>
          </LayoutGroup>
        )}
        {q.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {t('loadMore')}
            </Button>
          </div>
        )}
      </div>

      {/* Your rank stays pinned at the bottom of the screen. */}
      {!blocked && !q.isPending && (
        <div className="bg-card/95 border-primary sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] rounded-lg border-2 shadow-lg backdrop-blur lg:bottom-4">
          {me && !meVisible ? (
            <LbRow r={me} youLabel={t('you')} />
          ) : !me ? (
            <p className="text-muted-foreground p-4 text-sm">{t('notRanked')}</p>
          ) : (
            <p className="p-4 text-sm font-bold">
              {t('yourRank')}: #{me.rank}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LbRow({ r, youLabel }: { r: Row; youLabel: string }) {
  const medal =
    r.rank === 1
      ? 'text-signal-amber'
      : r.rank === 2
        ? 'text-slate-400'
        : r.rank === 3
          ? 'text-floodwater'
          : '';
  return (
    <div
      className={cn(
        'flex h-16 items-center gap-3 border-b px-4 last:border-b-0',
        r.is_me && 'bg-accent',
      )}
    >
      <span className={cn('font-display w-10 text-xl font-bold tabular-nums', medal)}>
        {r.rank <= 3 ? <Crown className="inline size-5" aria-label={`#${r.rank}`} /> : `#${r.rank}`}
      </span>
      <BlockyAvatar config={r.avatar_config} size={26} />
      <span className="min-w-0 flex-1 truncate font-bold">
        {r.username}
        {r.is_me && (
          <span className="bg-primary text-primary-foreground ml-2 rounded-sm px-1.5 text-xs">
            {youLabel}
          </span>
        )}
        {r.barangay && (
          <span className="text-muted-foreground block truncate text-xs font-normal">
            {r.barangay}
          </span>
        )}
      </span>
      <span className="text-muted-foreground hidden items-center gap-0.5 text-sm sm:flex">
        <Star className="fill-signal-amber text-signal-amber size-4" aria-hidden /> {r.stars}
      </span>
      <span className="font-display w-20 text-right text-xl font-bold tabular-nums">{r.score}</span>
    </div>
  );
}
