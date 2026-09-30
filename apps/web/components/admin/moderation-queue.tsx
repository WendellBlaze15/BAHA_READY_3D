'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Ban, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Flagged = {
  id: string;
  user_id: string;
  username: string;
  level_id: number;
  score: number | null;
  stars: number | null;
  status: string;
  flag_reasons: string[];
  started_at: string;
  void_reason: string | null;
};
type Ev = { t: number; type: string; payload: Record<string, unknown> };

export function ModerationQueue() {
  const t = useTranslations('admin');
  const format = useFormatter();
  const errText = useApiErrorText();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: qk.admin.flagged(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().rpc('flagged_attempts', {
        p_include_voided: true,
      });
      if (error) throw error;
      return data as Flagged[];
    },
    staleTime: 10_000,
  });

  const act = async (a: Flagged, action: 'void' | 'restore') => {
    setBusy(a.id);
    try {
      await apiPost(`/api/admin/attempts/${a.id}`, { action, reason: reason[a.id]?.trim() ?? '' });
      toast.success(action === 'void' ? t('voided') : t('restored'));
      void qc.invalidateQueries({ queryKey: qk.admin.flagged() });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">{t('moderationTitle')}</h1>
      {isPending ? (
        <SkeletonCard className="h-40" />
      ) : !data?.length ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-6">{t('noFlagged')}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{a.username}</span>
                <span className="text-muted-foreground text-sm">
                  L{a.level_id} · {a.score ?? '—'} pts · {a.stars ?? 0}★ ·{' '}
                  {format.relativeTime(new Date(a.started_at))}
                </span>
                {a.status === 'voided' && (
                  <span className="bg-signal-red rounded-sm px-2 text-xs font-bold text-white">
                    {t('voided')}
                  </span>
                )}
                <span className="flex flex-wrap gap-1">
                  {a.flag_reasons.map((r) => (
                    <code
                      key={r}
                      className="bg-signal-amber/20 rounded-sm px-1.5 text-xs font-bold"
                    >
                      {r}
                    </code>
                  ))}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto min-h-10"
                  onClick={() => setOpen(open === a.id ? null : a.id)}
                  aria-expanded={open === a.id}
                >
                  {t('timeline')} <ChevronDown className="size-4" aria-hidden />
                </Button>
              </div>
              {open === a.id && <Timeline attemptId={a.id} />}
              <div className="mt-3 flex flex-wrap gap-2">
                <Input
                  placeholder={t('reason')}
                  aria-label={t('reason')}
                  value={reason[a.id] ?? ''}
                  maxLength={500}
                  className="h-11 min-w-60 flex-1"
                  onChange={(e) => setReason((r) => ({ ...r, [a.id]: e.target.value }))}
                />
                {a.status !== 'voided' && (
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    disabled={busy === a.id || (reason[a.id]?.trim().length ?? 0) < 3}
                    onClick={() => void act(a, 'void')}
                  >
                    {busy === a.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Ban aria-hidden />
                    )}{' '}
                    {t('voidScore')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy === a.id || (reason[a.id]?.trim().length ?? 0) < 3}
                  onClick={() => void act(a, 'restore')}
                >
                  <RotateCcw aria-hidden /> {t('restore')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Event timeline: movement path (SVG) + discrete events list for reviewers. */
function Timeline({ attemptId }: { attemptId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['admin', 'attempt-events', attemptId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/attempts/${attemptId}`);
      const env = (await res.json()) as { data: { events: Ev[] } | null };
      return env.data?.events ?? [];
    },
  });
  if (isPending) return <div className="skeleton mt-3 h-40 w-full" />;
  const evs = data ?? [];
  const pos = evs
    .filter((e) => e.type === 'pos')
    .map((e) => ({ x: Number(e.payload.x), z: Number(e.payload.z), t: e.t }));
  const xs = pos.map((p) => p.x);
  const zs = pos.map((p) => p.z);
  const [minX, maxX, minZ, maxZ] = [
    Math.min(...xs, 0),
    Math.max(...xs, 1),
    Math.min(...zs, 0),
    Math.max(...zs, 1),
  ];
  const sx = (x: number) => ((x - minX) / (maxX - minX || 1)) * 280 + 10;
  const sz = (z: number) => ((z - minZ) / (maxZ - minZ || 1)) * 180 + 10;
  // Highlight jumps > 5m between consecutive samples (likely SPEED_IMPOSSIBLE).
  const jumps = pos.slice(1).filter((p, i) => Math.hypot(p.x - pos[i]!.x, p.z - pos[i]!.z) > 5);
  const discrete = evs.filter((e) => e.type !== 'pos');
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-[300px_1fr]">
      <svg
        viewBox="0 0 300 200"
        className="bg-muted w-full rounded-lg"
        role="img"
        aria-label="Movement path"
      >
        <polyline
          fill="none"
          stroke="var(--lake)"
          strokeWidth="2"
          points={pos.map((p) => `${sx(p.x)},${sz(p.z)}`).join(' ')}
        />
        {jumps.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sz(p.z)} r="5" fill="var(--signal-red)" />
        ))}
        {pos[0] && <circle cx={sx(pos[0].x)} cy={sz(pos[0].z)} r="4" fill="var(--evac-green)" />}
      </svg>
      <ol className="max-h-52 overflow-y-auto font-mono text-xs">
        {discrete.map((e, i) => (
          <li key={i} className="border-b py-0.5">
            <span className="text-muted-foreground">{e.t.toFixed(1)}s</span> {e.type}{' '}
            {JSON.stringify(e.payload)}
          </li>
        ))}
      </ol>
    </div>
  );
}
