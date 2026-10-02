'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DIFFICULTIES } from '@baha/shared/survival';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { useRunResult, useSurvivalBoard } from '@/lib/data/survival';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { QueryError } from '@/components/query-error';
import { SkeletonCard, SkeletonLeaderboardRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { ResultsView } from './results';

export function SurvivalLeaderboard() {
  const t = useTranslations('survival');
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [team, setTeam] = useState<'solo' | 'team'>('team');
  const [period, setPeriod] = useState<'weekly' | 'all_time'>('weekly');
  const q = useSurvivalBoard(difficulty, team, period);
  const seg = <T extends string>(
    values: readonly T[],
    value: T,
    set: (v: T) => void,
    label: (v: T) => string,
  ) => (
    <div className="flex flex-wrap gap-1.5" role="group">
      {values.map((v) => (
        <Button
          key={v}
          size="sm"
          variant={v === value ? 'default' : 'outline'}
          aria-pressed={v === value}
          onClick={() => set(v)}
        >
          {label(v)}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-3xl font-bold">{t('board.title')}</h1>
      <div className="flex flex-wrap gap-3">
        {seg(DIFFICULTIES, difficulty, setDifficulty, (d) => t(`difficulty.${d}`))}
        {seg(['solo', 'team'] as const, team, setTeam, (v) => t(`board.${v}`))}
        {seg(['weekly', 'all_time'] as const, period, setPeriod, (v) => t(`board.${v}`))}
      </div>
      {q.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonLeaderboardRow key={i} />
          ))}
        </div>
      ) : q.isError ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : q.data.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-5">{t('board.empty')}</p>
      ) : (
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {q.data.map((r) => (
            <li
              key={r.run_id}
              className="bg-card flex min-w-0 items-center gap-3 rounded-lg border p-3"
            >
              <span className="w-8 shrink-0 text-center text-lg font-bold">{r.rank}</span>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {r.members.map((m) => (
                  <span key={m.username} className="flex min-w-0 items-center gap-1 text-sm">
                    <BlockyAvatar
                      config={m.avatar_config as Partial<AvatarConfig>}
                      size={24}
                      title={m.username}
                    />
                    <span className="max-w-[8rem] truncate">{m.username}</span>
                  </span>
                ))}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold">{r.final_score.toLocaleString()}</p>
                <p className="text-muted-foreground text-xs">
                  {t(`ending.${r.ending}` as 'ending.failed')}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Saved results of a finished run (also how players revisit "Mga Natutunan"). */
export function RunResults({ runId }: { runId: string }) {
  const q = useRunResult(runId);
  if (q.isPending)
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <SkeletonCard />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <QueryError error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      </div>
    );
  const r = q.data;
  const pp = Object.values(r.per_player ?? {});
  return (
    <ResultsView
      data={{
        ending: r.ending,
        score: r.final_score,
        difficulty: r.difficulty,
        summary: {
          daysSurvived: r.days_survived,
          boatStagesCompleted: (r as unknown as { boat_stage?: number }).boat_stage ?? 0,
          playersRescued: pp.filter((p) => p.rescued).length,
          npcsRescued: 0,
          deaths: pp.reduce((n, p) => n + (p.deaths ?? 0), 0),
        },
        learning: r.learning_summary ?? {},
      }}
    />
  );
}
