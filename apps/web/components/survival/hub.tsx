'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Anchor, LifeBuoy, LogOut, Play, Trophy, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import type { AvatarConfig } from '@/lib/avatar/presets';
import {
  useLeaveRun,
  useMyRuns,
  useResumeRun,
  useSurvivalSettings,
  type SurvivalRunRow,
} from '@/lib/data/survival';
import { gameServerConfigured } from '@/lib/survival/client';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { QueryError } from '@/components/query-error';
import { SkeletonCard } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function SurvivalHub() {
  const t = useTranslations('survival');
  const settings = useSurvivalSettings();
  const runs = useMyRuns();
  const off = settings.data && !settings.data.enabled;
  const noServer = !gameServerConfigured();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold break-words sm:text-4xl">
          <LifeBuoy className="text-signal-amber size-8 shrink-0" aria-hidden />
          {t('title')}
        </h1>
        <p className="text-muted-foreground max-w-2xl">{t('lede')}</p>
      </header>

      {(off || noServer) && (
        <p role="status" className="bg-card rounded-lg border border-dashed p-4">
          {off ? t('disabled') : t('unavailable')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button asChild size="lg" className="h-14 text-base" disabled={off || noServer}>
          <Link href="/survival/new">
            <Play aria-hidden /> {t('newGame')}
          </Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="secondary"
          className="h-14 text-base"
          disabled={off || noServer}
        >
          <Link href="/survival/join">
            <Users aria-hidden /> {t('join')}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="h-14 text-base">
          <Link href="/survival/leaderboard">
            <Trophy aria-hidden /> {t('leaderboard')}
          </Link>
        </Button>
      </div>

      <section aria-labelledby="my-runs" className="space-y-3">
        <h2 id="my-runs" className="text-xl font-semibold">
          {t('myRuns')}
        </h2>
        {runs.isPending ? (
          <div className="grid gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : runs.isError ? (
          <QueryError
            error={runs.error}
            onRetry={() => runs.refetch()}
            retrying={runs.isFetching}
          />
        ) : runs.data.length === 0 ? (
          <p className="text-muted-foreground bg-card rounded-lg border p-5">{t('noRuns')}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {runs.data.map((r) => (
              <RunCard key={r.run_id} run={r} disabled={!!off || noServer} />
            ))}
          </ul>
        )}
        {settings.data && (
          <p className="text-muted-foreground text-sm">
            {t('runsLimit', { max: settings.data.maxActiveRuns })}
          </p>
        )}
      </section>
    </div>
  );
}

function RunCard({ run, disabled }: { run: SurvivalRunRow; disabled: boolean }) {
  const t = useTranslations('survival');
  const tr = useTranslations();
  const router = useRouter();
  const resume = useResumeRun();
  const leave = useLeaveRun();
  const [confirm, setConfirm] = useState(false);
  const live = run.status === 'active';
  const done = ['completed', 'failed'].includes(run.status);

  const onResume = () =>
    resume.mutate(run.run_id, {
      onSuccess: (r) => router.push(`/survival/room/${r.roomId}`),
      onError: (e) =>
        toast.error(tr((e as { messageKey?: string }).messageKey ?? 'errors.generic')),
    });

  return (
    <li className="bg-card min-w-0 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={live ? 'default' : 'secondary'}>
          {t(`status.${run.status}` as 'status.active')}
        </Badge>
        <Badge variant="outline">{t(`difficulty.${run.difficulty}`)}</Badge>
        <Badge variant="outline">{t(`mode.${run.mode}`)}</Badge>
        {run.is_host && <Badge variant="outline">{t('host')}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">{t('day', { day: run.current_day })}</span>
        <span className="flex items-center gap-1">
          <Anchor className="size-4" aria-hidden />
          {t('boatStage', { stage: run.boat_stage })}
        </span>
        {run.ending && <span>{t(`ending.${run.ending}` as 'ending.failed')}</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={t('teammates')}>
        {run.teammates
          .filter((m) => m.status === 'active')
          .map((m) => (
            <span key={m.user_id} className="flex min-w-0 items-center gap-1.5 text-sm">
              <BlockyAvatar
                config={m.avatar_config as Partial<AvatarConfig>}
                size={28}
                title={m.username}
              />
              <span className="max-w-[9rem] truncate">{m.username}</span>
            </span>
          ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {live && (
          <Button onClick={onResume} disabled={disabled || resume.isPending}>
            <Play aria-hidden /> {resume.isPending ? t('waking') : t('resume')}
          </Button>
        )}
        {done && (
          <Button asChild variant="secondary">
            <Link href={`/survival/runs/${run.run_id}`}>{t('viewResults')}</Link>
          </Button>
        )}
        {live && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <LogOut aria-hidden /> {t('leave')}
          </Button>
        )}
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('leaveTitle')}</DialogTitle>
            <DialogDescription>{t('leaveBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={leave.isPending}
              onClick={() =>
                leave.mutate(run.run_id, {
                  onSuccess: () => setConfirm(false),
                  onError: (e) =>
                    toast.error(tr((e as { messageKey?: string }).messageKey ?? 'errors.generic')),
                })
              }
            >
              {t('leaveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
