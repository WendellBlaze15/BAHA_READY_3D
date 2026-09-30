'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Play, Radio, Square, Star } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { useMyOwnedGroups } from '@/lib/data/facilitator';
import { useLiveChannel, type LivePhase } from '@/lib/realtime/live';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NoGroups } from './no-groups';
import { cn } from '@/lib/utils';

type Session = { id: string; code: string; status: string; level_id: number; group_id: string };

const PHASE_STYLE: Record<LivePhase, string> = {
  lobby: 'bg-muted',
  prep: 'bg-signal-amber/30',
  evac: 'bg-signal-4/30',
  done: 'bg-evac-green/30',
};

/** Projector-friendly facilitator view: big code, live roster with phases, start/end. */
export function LiveSessionPanel({
  levels,
  me,
}: {
  levels: { id: number; name_fil: string; name_en: string }[];
  me: { id: string; username: string };
}) {
  const t = useTranslations('fac');
  const locale = useLocale();
  const errText = useApiErrorText();
  const groups = useMyOwnedGroups();
  const [group, setGroup] = useState('');
  const [level, setLevel] = useState('1');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const gid = group || groups.data?.[0]?.id || '';
  const presenceMe = useMemo(
    () => ({ user_id: me.id, username: me.username, phase: 'lobby' as const, facilitator: true }),
    [me],
  );
  const { players } = useLiveChannel(session?.id ?? null, presenceMe, { onEnd: setSummary });

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await apiPost<Record<string, unknown>>('/api/live', body);
    } catch (e) {
      toast.error(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-4xl font-bold">{t('liveTitle')}</h1>
          <p className="text-muted-foreground">{t('liveLede')}</p>
        </div>
        {groups.isSuccess && !groups.data?.length && <NoGroups />}
        <div className="bg-card flex flex-wrap items-end gap-3 rounded-2xl border p-5">
          <Select value={gid} onValueChange={setGroup}>
            <SelectTrigger className="h-12 w-56" aria-label={t('chooseGroup')}>
              <SelectValue placeholder={t('chooseGroup')} />
            </SelectTrigger>
            <SelectContent>
              {(groups.data ?? [])
                .filter((g) => !g.is_archived)
                .map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="h-12 w-48" aria-label={t('chooseLevels')}>
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
          <Button
            disabled={!gid || busy}
            className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
            onClick={async () => {
              const s = (await call({
                action: 'create',
                group_id: gid,
                level_id: Number(level),
              })) as Session | null;
              if (s) setSession(s);
            }}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Radio aria-hidden />}{' '}
            {t('startSession')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-storm-slate text-mist auth-rain relative overflow-hidden rounded-2xl p-6 text-center">
        <div className="relative z-10 space-y-2">
          <p className="font-display text-signal-amber text-xl font-semibold">{t('sessionCode')}</p>
          <p className="font-display text-7xl font-bold tracking-[0.3em] sm:text-8xl">
            {session.code}
          </p>
          <p className="text-mist/80">
            {t('joinedPlayers')}: <span className="font-bold">{players.length}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {session.status !== 'running' ? (
          <Button
            disabled={busy || players.length === 0}
            className="bg-evac-green min-h-12 font-bold text-white"
            onClick={async () => {
              if (await call({ action: 'start', session_id: session.id }))
                setSession({ ...session, status: 'running' });
            }}
          >
            <Play className="fill-current" aria-hidden /> {t('startGame')}
          </Button>
        ) : null}
        <Button
          variant="destructive"
          disabled={busy}
          className="min-h-12"
          onClick={async () => {
            const r = await call({ action: 'end', session_id: session.id });
            if (r) setSummary((r.summary as Record<string, number>) ?? {});
          }}
        >
          <Square aria-hidden /> {t('endSession')}
        </Button>
      </div>
      {summary && (
        <p className="bg-card rounded-lg border p-4 font-bold">
          ✓ {summary.finished ?? 0} · 🏁 {summary.survived ?? 0} · Ø {summary.avg_score ?? 0}
        </p>
      )}
      {players.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-lg border p-6 text-center">
          {t('waiting')}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <li
              key={p.user_id}
              className={cn(
                'flex items-center justify-between rounded-lg border p-3',
                PHASE_STYLE[p.phase],
              )}
            >
              <span className="font-bold">{p.username}</span>
              <span className="flex items-center gap-2 text-sm">
                {t(`phase.${p.phase}`)}
                {p.phase === 'done' && typeof p.stars === 'number' && (
                  <>
                    <Star className="fill-signal-amber text-signal-amber size-4" aria-hidden />
                    {p.stars}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
