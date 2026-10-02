'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  chatWordlistSchema,
  filterChatMessage,
  lessonFor,
  toFilWords,
} from '@baha/shared/survival';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useRelativeTime } from '@/lib/i18n/use-relative-time';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { ReauthDialog } from '@/components/auth/reauth-dialog';
import { SkeletonCard, SkeletonTableRow } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SurvivalConfigEditor } from './config-editor';

const sb = () => getSupabaseBrowser();

export interface SurvivalAdminCaps {
  monitor: boolean;
  forceClose: boolean;
  config: boolean;
  reports: boolean;
  toggle: boolean;
}

/** Survival admin console (Section 21.5). Every action is audited; staff need aal2. */
export function SurvivalAdmin({ caps }: { caps: SurvivalAdminCaps }) {
  const t = useTranslations('survivalAdmin');
  const tabs = [
    caps.monitor && 'rooms',
    caps.reports && 'reports',
    caps.reports && 'restrictions',
    caps.config && 'config',
    caps.config && 'chat',
    (caps.reports || caps.config) && 'analytics',
    caps.toggle && 'system',
  ].filter(Boolean) as string[];
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      <Tabs defaultValue={tabs[0]}>
        <TabsList className="h-auto flex-wrap">
          {tabs.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}` as 'tabs.rooms')}
            </TabsTrigger>
          ))}
        </TabsList>
        {caps.monitor && (
          <TabsContent value="rooms">
            <Rooms canClose={caps.forceClose} />
          </TabsContent>
        )}
        {caps.reports && (
          <TabsContent value="reports">
            <Reports />
          </TabsContent>
        )}
        {caps.reports && (
          <TabsContent value="restrictions">
            <Restrictions />
          </TabsContent>
        )}
        {caps.config && (
          <TabsContent value="config">
            <SurvivalConfigEditor />
          </TabsContent>
        )}
        {caps.config && (
          <TabsContent value="chat">
            <ChatFilter />
          </TabsContent>
        )}
        <TabsContent value="analytics">
          <Analytics />
        </TabsContent>
        {caps.toggle && (
          <TabsContent value="system">
            <KillSwitch />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ── Live rooms (polls every 5 s) ────────────────────────────────────────────

type RoomRow = {
  roomId: string;
  code: string;
  runId: string | null;
  mode?: string;
  difficulty?: string;
  phase: string;
  day: number;
  clients: number;
  maxClients: number;
  flags: string[];
  createdAt?: number;
};

function Rooms({ canClose }: { canClose: boolean }) {
  const t = useTranslations('survivalAdmin');
  const rel = useRelativeTime();
  const errText = useApiErrorText();
  const [closing, setClosing] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'survival', 'rooms'],
    queryFn: async () => {
      const r = await fetch('/api/admin/survival/rooms');
      const body = (await r.json()) as { data: { rooms: RoomRow[]; memory: number } | null };
      if (!r.ok || !body.data) throw new Error('unavailable');
      return body.data;
    },
    refetchInterval: 5000,
  });
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          <RefreshCw aria-hidden /> {t('refresh')}
        </Button>
        {q.data && (
          <span className="text-muted-foreground text-xs">
            {t('rooms.memory', { mb: Math.round(q.data.memory / 1e6) })}
          </span>
        )}
      </div>
      {q.isError && (
        <p className="bg-card rounded-lg border border-dashed p-4">{t('rooms.unavailable')}</p>
      )}
      {q.isPending ? (
        <SkeletonTableRow cols={6} />
      ) : q.data && q.data.rooms.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {['code', 'run', 'mode', 'phase', 'day', 'players', 'flags', 'age'].map((h) => (
                  <th key={h} className="p-2 font-semibold">
                    {t(`rooms.${h}` as 'rooms.code')}
                  </th>
                ))}
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {q.data?.rooms.map((r) => (
                <tr key={r.roomId} className="border-t">
                  <td className="p-2 font-mono">{r.code || '—'}</td>
                  <td className="p-2 font-mono text-xs">{r.runId?.slice(0, 8) ?? '—'}</td>
                  <td className="p-2">
                    {r.mode} · {r.difficulty}
                  </td>
                  <td className="p-2">{r.phase}</td>
                  <td className="p-2">{r.day || '—'}</td>
                  <td className="p-2">
                    {r.clients}/{r.maxClients}
                  </td>
                  <td className="p-2">
                    {r.flags.length ? <Badge variant="destructive">{r.flags.length}</Badge> : '—'}
                  </td>
                  <td className="p-2 text-xs">
                    {r.createdAt ? rel(new Date(r.createdAt).toISOString()) : '—'}
                  </td>
                  <td className="p-2 text-right">
                    {canClose && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setClosing(r.roomId)}
                        title={t('rooms.forceCloseHint')}
                      >
                        {t('rooms.forceClose')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReauthDialog
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        hasTotp
        emailDeliverable={false}
        onConfirmed={async () => {
          if (!closing) return;
          try {
            await apiPost(`/api/admin/survival/rooms/${closing}/close`);
            toast.success(t('rooms.closed'));
            void q.refetch();
          } catch (e) {
            toast.error(errText(e));
          }
          setClosing(null);
        }}
      />
    </section>
  );
}

// ── Reports queue (high priority first) + auto-moderation flags ───────────

type ReportRow = {
  id: string;
  run_id: string | null;
  reason: string;
  priority: 'normal' | 'high';
  status: string;
  created_at: string;
  message_id: number | null;
  reporter: { username: string } | null;
  reported: { username: string } | null;
};
type EvidenceRow = {
  id: number;
  sender_id: string;
  username: string;
  body_original: string;
  body_delivered: string | null;
  status: string;
  filter_hits: string[];
  created_at: string;
};

function Reports() {
  const t = useTranslations('survivalAdmin');
  const tc = useTranslations('survival.chat.reason');
  const rel = useRelativeTime();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'survival', 'reports', scope],
    queryFn: async () => {
      let query = sb()
        .from('survival_reports')
        .select(
          'id, run_id, reason, priority, status, created_at, message_id, reporter:profiles!survival_reports_reporter_id_fkey(username), reported:profiles!survival_reports_reported_id_fkey(username)',
        )
        .order('created_at', { ascending: false })
        .limit(100);
      if (scope === 'open') query = query.eq('status', 'open');
      const { data, error } = await query;
      if (error) throw error;
      const rows = data as unknown as ReportRow[];
      return rows.sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high'));
    },
    refetchInterval: 15000,
  });
  const flags = useQuery({
    queryKey: ['admin', 'survival', 'flags'],
    queryFn: async () => {
      const { data, error } = await sb()
        .from('survival_chat_flags')
        .select(
          'id, reason, created_at, status, user:profiles!survival_chat_flags_user_id_fkey(username)',
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as {
        id: string;
        reason: string;
        created_at: string;
        user: { username: string } | null;
      }[];
    },
  });

  return (
    <section className="space-y-4">
      <div className="flex gap-2">
        {(['open', 'all'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={scope === s ? 'default' : 'outline'}
            onClick={() => setScope(s)}
          >
            {t(`reports.${s}`)}
          </Button>
        ))}
      </div>
      {q.isPending ? (
        <SkeletonCard />
      ) : !q.data?.length ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {q.data.map((r) => (
            <ReportItem
              key={r.id}
              r={r}
              reasonText={tc(r.reason as 'other')}
              when={rel(r.created_at)}
              onDone={() => void qc.invalidateQueries({ queryKey: ['admin', 'survival'] })}
            />
          ))}
        </ul>
      )}
      <section className="space-y-2">
        <h3 className="font-semibold">{t('reports.flags')}</h3>
        {!flags.data?.length ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {flags.data.map((f) => (
              <li
                key={f.id}
                className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
              >
                <AlertTriangle className="text-signal-amber size-4" aria-hidden />
                <span className="font-semibold">{f.user?.username}</span>
                <span className="text-muted-foreground">{f.reason}</span>
                <span className="text-muted-foreground text-xs">{rel(f.created_at)}</span>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={async () => {
                    await sb()
                      .from('survival_chat_flags')
                      .update({ status: 'reviewed', reviewed_at: new Date().toISOString() })
                      .eq('id', f.id);
                    void flags.refetch();
                  }}
                >
                  {t('reports.markReviewed')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function ReportItem({
  r,
  reasonText,
  when,
  onDone,
}: {
  r: ReportRow;
  reasonText: string;
  when: string;
  onDone: () => void;
}) {
  const t = useTranslations('survivalAdmin');
  const errText = useApiErrorText();
  const [evidence, setEvidence] = useState<EvidenceRow[] | null>(null);
  const [note, setNote] = useState('');
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await apiPost(`/api/admin/survival/reports/${r.id}`, body);
      toast.success(t('reports.done'));
      onDone();
    } catch (e) {
      toast.error(errText(e));
    }
    setBusy(false);
  };
  const loadEvidence = async () => {
    const res = await fetch(`/api/admin/survival/reports/${r.id}/evidence`);
    const b = (await res.json()) as { data: EvidenceRow[] | null };
    setEvidence(b.data ?? []);
  };
  const needsNote = note.trim().length < 3;
  return (
    <li
      className={cn(
        'bg-card min-w-0 rounded-lg border p-3',
        r.priority === 'high' && 'border-red-500',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {r.priority === 'high' && (
          <Badge variant="destructive">
            <ShieldAlert aria-hidden /> {t('reports.high')}
          </Badge>
        )}
        <Badge variant="outline">{t(`reports.status.${r.status}` as 'reports.status.open')}</Badge>
        <span className="font-semibold">{reasonText}</span>
        <span className="text-muted-foreground text-xs">{when}</span>
      </div>
      <p className="mt-1 text-sm">
        {t('reports.reporter')}: <b>{r.reporter?.username ?? '—'}</b> · {t('reports.reported')}:{' '}
        <b>{r.reported?.username ?? '—'}</b>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={loadEvidence}>
          {t('reports.evidence')}
        </Button>
      </div>
      {evidence && (
        <div className="mt-2 space-y-1 rounded-md border p-2">
          <p className="text-muted-foreground text-xs">{t('reports.evidenceHint')}</p>
          <ol className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {evidence.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'flex flex-wrap items-start gap-2',
                  m.id === r.message_id && 'rounded bg-amber-100 p-1 dark:bg-amber-900/40',
                )}
              >
                <span className="font-semibold">{m.username}:</span>
                <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                  {m.body_original}
                </span>
                {m.filter_hits.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {t('reports.filtered', { hits: m.filter_hits.join(', ') })}
                  </span>
                )}
                {m.status === 'hidden' ? (
                  <Badge variant="secondary">{t('reports.hidden')}</Badge>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => act({ action: 'hide', messageId: m.id }).then(loadEvidence)}
                  >
                    {t('reports.hide')}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {r.status === 'open' && (
        <div className="mt-3 space-y-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            aria-label={t('note')}
            maxLength={500}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => act({ action: 'dismiss', note: note || undefined })}
            >
              {t('reports.dismiss')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || needsNote}
              onClick={() => act({ action: 'warn', note })}
            >
              {t('reports.warn')}
            </Button>
            <label className="flex items-center gap-1 text-sm">
              {t('reports.days')}
              <select
                className="bg-background rounded border px-1 py-1"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[1, 3, 7, 30, 0].map((d) => (
                  <option key={d} value={d}>
                    {d ? t('reports.daysN', { n: d }) : t('reports.permanent')}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || needsNote}
              onClick={() => act({ action: 'restrict', scope: 'chat', days, note })}
            >
              {t('reports.restrictChat')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || needsNote}
              onClick={() => act({ action: 'restrict', scope: 'survival', days, note })}
            >
              {t('reports.restrictSurvival')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || needsNote}
              onClick={() => act({ action: 'escalate', note })}
            >
              {t('reports.escalate')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Restrictions ────────────────────────────────────────────────────────────

function Restrictions() {
  const t = useTranslations('survivalAdmin');
  const errText = useApiErrorText();
  const [scope, setScope] = useState<'all' | 'chat' | 'survival'>('all');
  const q = useQuery({
    queryKey: ['admin', 'survival', 'restrictions', scope],
    queryFn: async () => {
      let query = sb()
        .from('survival_restrictions')
        .select(
          'id, scope, reason, ends_at, created_at, user:profiles!survival_restrictions_user_id_fkey(username)',
        )
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (scope !== 'all') query = query.eq('scope', scope);
      const { data, error } = await query;
      if (error) throw error;
      const now = Date.now();
      return (
        data as unknown as {
          id: string;
          scope: string;
          reason: string;
          ends_at: string | null;
          user: { username: string } | null;
        }[]
      ).filter((r) => !r.ends_at || new Date(r.ends_at).getTime() > now);
    },
  });
  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        {(['all', 'chat', 'survival'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={scope === s ? 'default' : 'outline'}
            onClick={() => setScope(s)}
          >
            {s === 'all' ? t('reports.all') : t(`restrictions.${s}`)}
          </Button>
        ))}
      </div>
      {q.isPending ? (
        <SkeletonCard />
      ) : !q.data?.length ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {q.data.map((r) => (
            <li
              key={r.id}
              className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
            >
              <Badge variant={r.scope === 'survival' ? 'destructive' : 'secondary'}>
                {t(`restrictions.${r.scope}` as 'restrictions.chat')}
              </Badge>
              <b>{r.user?.username}</b>
              <span className="text-muted-foreground min-w-0 flex-1 break-words">{r.reason}</span>
              <span className="text-xs">
                {t('restrictions.until')}:{' '}
                {r.ends_at ? new Date(r.ends_at).toLocaleString() : t('restrictions.forever')}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await apiPost(`/api/admin/survival/restrictions/${r.id}`, { action: 'revoke' });
                    toast.success(t('restrictions.revoked'));
                    void q.refetch();
                  } catch (e) {
                    toast.error(errText(e));
                  }
                }}
              >
                {t('restrictions.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Chat filter settings + test box ─────────────────────────────────────────

function ChatFilter() {
  const t = useTranslations('survivalAdmin.chat');
  const ta = useTranslations('survivalAdmin');
  const errText = useApiErrorText();
  const q = useQuery({
    queryKey: ['admin', 'survival', 'chat-settings'],
    queryFn: async () => {
      const { data, error } = await sb()
        .from('system_settings')
        .select('key, value')
        .in('key', ['survival_chat_enabled', 'survival_chat_wordlist']);
      if (error) throw error;
      const get = (k: string) => data.find((r) => r.key === k)?.value;
      const list = chatWordlistSchema.safeParse(get('survival_chat_wordlist'));
      return {
        enabled: get('survival_chat_enabled') !== false && get('survival_chat_enabled') !== 'false',
        list: list.success ? list.data : { words: [], blockedPhrases: [], version: 1 },
      };
    },
  });
  const [words, setWords] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<string | null>(null);
  const [sample, setSample] = useState('');
  const w = words ?? q.data?.list.words.join('\n') ?? '';
  const p = phrases ?? q.data?.list.blockedPhrases.join('\n') ?? '';
  const lines = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const result = useMemo(() => {
    if (!sample.trim()) return null;
    try {
      return filterChatMessage(sample, {
        maxLength: 150,
        extraWords: toFilWords(lines(w).map((x) => x.toLowerCase())),
        blockedPhrases: lines(p),
      });
    } catch {
      return null;
    }
  }, [sample, w, p]);
  if (q.isPending) return <SkeletonCard />;
  const save = async (body: Record<string, unknown>) => {
    try {
      await apiPost('/api/admin/survival/chat', body);
      toast.success(ta('saved'));
      setWords(null);
      setPhrases(null);
      void q.refetch();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="bg-card space-y-3 rounded-lg border p-4">
        <label className="flex items-center justify-between gap-3" htmlFor="chat-on">
          <span>
            <span className="font-semibold">{t('enabled')}</span>
            <span className="text-muted-foreground block text-xs">{t('enabledHint')}</span>
          </span>
          <Switch
            id="chat-on"
            checked={!!q.data?.enabled}
            onCheckedChange={(v) => save({ enabled: v })}
          />
        </label>
        <p className="text-muted-foreground text-xs">
          {t('version', { version: q.data?.list.version ?? 1 })}
        </p>
        <label className="block text-sm" htmlFor="chat-words">
          {t('words')}
          <Textarea
            id="chat-words"
            rows={6}
            value={w}
            onChange={(e) => setWords(e.target.value)}
            className="mt-1 font-mono"
          />
        </label>
        <label className="block text-sm" htmlFor="chat-phrases">
          {t('phrases')}
          <Textarea
            id="chat-phrases"
            rows={5}
            value={p}
            onChange={(e) => setPhrases(e.target.value)}
            className="mt-1 font-mono"
          />
        </label>
        <Button
          onClick={() =>
            save({
              wordlist: { words: lines(w).map((x) => x.toLowerCase()), blockedPhrases: lines(p) },
            })
          }
          disabled={words === null && phrases === null}
        >
          {ta('save')}
        </Button>
      </div>
      <div className="bg-card space-y-3 rounded-lg border p-4">
        <label className="block text-sm font-semibold" htmlFor="chat-test">
          {t('test')}
          <Input
            id="chat-test"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder={t('testPlaceholder')}
            className="mt-1 font-normal"
          />
        </label>
        {result && (
          <div role="status" className="rounded-md border p-3 text-sm">
            <p className="font-semibold">
              {t('result')}: {t(result.status)}
            </p>
            {'text' in result && <p className="mt-1 font-mono">{result.text}</p>}
            {result.hits.length > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">{result.hits.join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Analytics ───────────────────────────────────────────────────────────────

type AnalyticsData = {
  by_difficulty: { difficulty: string; started: number; completed: number; rescued: number }[];
  avg_days_survived: number | null;
  by_team_size: { team_size: number; runs: number; full_rescue_rate: number }[];
  top_mistakes: { event_key: string; count: number }[];
  top_good: { event_key: string; count: number }[];
  open_reports: number;
  open_flags: number;
  active_restrictions: number;
};

function Analytics() {
  const t = useTranslations('survivalAdmin.analytics');
  const td = useTranslations('survival.difficulty');
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['admin', 'survival', 'analytics', days],
    queryFn: async () => {
      const { data, error } = await sb().rpc('survival_admin_analytics', { p_days: days });
      if (error) throw error;
      return data as unknown as AnalyticsData;
    },
  });
  if (q.isPending) return <SkeletonCard />;
  const a = q.data;
  if (!a) return null;
  const lesson = (k: string) => lessonFor(k)?.en ?? k;
  const stat = (label: string, v: number | string | null) => (
    <div className="bg-card rounded-lg border p-3">
      <p className="text-2xl font-bold">{v ?? '—'}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
  return (
    <section className="space-y-4">
      <div className="flex gap-2">
        {[7, 30, 90].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? 'default' : 'outline'}
            onClick={() => setDays(d)}
          >
            {t('window', { days: d })}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {stat(t('avgDays'), a.avg_days_survived)}
        {stat(t('openReports'), a.open_reports)}
        {stat(t('openFlags'), a.open_flags)}
        {stat(t('activeRestrictions'), a.active_restrictions)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card overflow-x-auto rounded-lg border p-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="p-1" />
                <th className="p-1">{t('started')}</th>
                <th className="p-1">{t('completed')}</th>
                <th className="p-1">{t('rescued')}</th>
              </tr>
            </thead>
            <tbody>
              {a.by_difficulty.map((d) => (
                <tr key={d.difficulty} className="border-t">
                  <td className="p-1 font-semibold">{td(d.difficulty as 'easy')}</td>
                  <td className="p-1">{d.started}</td>
                  <td className="p-1">{d.completed}</td>
                  <td className="p-1">{d.rescued}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="mt-3 text-sm font-semibold">{t('teamSize')}</h4>
          <ul className="text-sm">
            {a.by_team_size.map((r) => (
              <li key={r.team_size}>
                {t('players', { n: r.team_size })}: {Math.round(r.full_rescue_rate * 100)}% (
                {t('runs', { n: r.runs })})
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-card space-y-3 rounded-lg border p-3 text-sm">
          <div>
            <h4 className="font-semibold">{t('mistakes')}</h4>
            <ol className="list-decimal pl-5">
              {a.top_mistakes.map((m) => (
                <li key={m.event_key}>
                  {lesson(m.event_key)} — {m.count}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4 className="font-semibold">{t('good')}</h4>
            <ol className="list-decimal pl-5">
              {a.top_good.map((m) => (
                <li key={m.event_key}>
                  {lesson(m.event_key)} — {m.count}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Kill switch (super admin, re-auth) ──────────────────────────────────────

function KillSwitch() {
  const t = useTranslations('survivalAdmin.system');
  const errText = useApiErrorText();
  const q = useQuery({
    queryKey: ['admin', 'survival', 'killswitch'],
    queryFn: async () => {
      const { data } = await sb()
        .from('system_settings')
        .select('key, value')
        .in('key', ['survival_enabled', 'survival_disabled_message']);
      const get = (k: string) => data?.find((r) => r.key === k)?.value;
      const msg = (get('survival_disabled_message') ?? {}) as { fil?: string; en?: string };
      return {
        enabled: get('survival_enabled') !== false && get('survival_enabled') !== 'false',
        msg,
      };
    },
  });
  const [fil, setFil] = useState<string | null>(null);
  const [en, setEn] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (q.isPending || !q.data) return <SkeletonCard />;
  const enabled = q.data.enabled;
  return (
    <section className="bg-card max-w-2xl space-y-3 rounded-lg border p-4">
      <p className={cn('text-lg font-bold', enabled ? 'text-emerald-700' : 'text-red-700')}>
        {enabled ? t('enabled') : t('disabled')}
      </p>
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <label className="block text-sm" htmlFor="ks-fil">
        {t('messageFil')}
        <Input
          id="ks-fil"
          value={fil ?? q.data.msg.fil ?? ''}
          onChange={(e) => setFil(e.target.value)}
          className="mt-1"
        />
      </label>
      <label className="block text-sm" htmlFor="ks-en">
        {t('messageEn')}
        <Input
          id="ks-en"
          value={en ?? q.data.msg.en ?? ''}
          onChange={(e) => setEn(e.target.value)}
          className="mt-1"
        />
      </label>
      <Button variant={enabled ? 'destructive' : 'default'} onClick={() => setConfirm(true)}>
        {enabled ? t('toggleOff') : t('toggleOn')}
      </Button>
      <ReauthDialog
        open={confirm}
        onOpenChange={setConfirm}
        hasTotp
        emailDeliverable={false}
        onConfirmed={async () => {
          try {
            const msgFil = fil ?? q.data.msg.fil ?? '';
            const msgEn = en ?? q.data.msg.en ?? '';
            await apiPost('/api/admin/survival/toggle', {
              enabled: !enabled,
              ...(msgFil.length >= 3 && msgEn.length >= 3
                ? { message: { fil: msgFil, en: msgEn } }
                : {}),
            });
            toast.success(t('done'));
            void q.refetch();
          } catch (e) {
            toast.error(errText(e));
          }
          setConfirm(false);
        }}
      />
    </section>
  );
}
