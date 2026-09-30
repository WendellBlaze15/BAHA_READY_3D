'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useMyOwnedGroups } from '@/lib/data/facilitator';
import { SkeletonChart } from '@/components/skeletons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Analytics = {
  score_distribution: { bucket: number; count: number }[];
  missed_items: { key: string; count: number }[];
  hazard_hits: { key: string; count: number }[];
  improvement: { attempt: number; avg_score: number }[];
  pre_post: {
    first_avg: number | null;
    latest_avg: number | null;
    first_stars: number | null;
    latest_stars: number | null;
  };
  pass_rate: number | null;
  attempts: number;
};

const AXIS = { fontSize: 12, fill: 'var(--muted-foreground)' };

export function AnalyticsView({
  levels,
  labels,
}: {
  levels: { id: number; name_fil: string; name_en: string }[];
  labels: Record<string, { fil: string; en: string }>;
}) {
  const t = useTranslations('fac');
  const locale = useLocale();
  const groups = useMyOwnedGroups();
  const [group, setGroup] = useState<string>('');
  const [level, setLevel] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const gid = group || groups.data?.[0]?.id || '';
  const filters = { level, from, to };
  const L = (k: string) => (labels[k] ? (locale === 'en' ? labels[k].en : labels[k].fil) : k);

  const q = useQuery({
    queryKey: qk.groups.analytics(gid, filters),
    enabled: !!gid,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().rpc('group_analytics', {
        p_group_id: gid,
        p_from: from ? new Date(`${from}T00:00:00+08:00`).toISOString() : undefined,
        p_to: to ? new Date(`${to}T23:59:59+08:00`).toISOString() : undefined,
        p_level_id: level === 'all' ? undefined : Number(level),
      });
      if (error) throw error;
      return data as unknown as Analytics;
    },
    staleTime: 30_000,
  });
  const a = q.data;

  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('analyticsTitle')}</h1>
      <div className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label>{t('chooseGroup')}</Label>
          <Select value={gid} onValueChange={setGroup}>
            <SelectTrigger className="h-11 w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(groups.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('chooseLevels')}</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="h-11 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allLevels')}</SelectItem>
              {levels.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {locale === 'en' ? l.name_en : l.name_fil}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">{t('from')}</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">{t('to')}</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11"
          />
        </div>
      </div>

      {q.isPending || !a ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonChart key={i} />
          ))}
        </div>
      ) : a.attempts === 0 ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-6">{t('noData')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Chart title={t('scoreDistribution')}>
            <BarChart
              data={a.score_distribution.map((d) => ({
                range: `${(d.bucket - 1) * 300}+`,
                count: d.count,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" tick={AXIS} />
              <YAxis allowDecimals={false} tick={AXIS} />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="var(--lake)"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </Chart>
          <Chart title={t('missedItems')}>
            <BarChart
              layout="vertical"
              data={a.missed_items.map((d) => ({ name: L(d.key), count: d.count }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={AXIS} />
              <YAxis type="category" dataKey="name" width={130} tick={AXIS} />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="var(--signal-amber)"
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </Chart>
          <Chart title={t('hazardHits')}>
            <BarChart data={a.hazard_hits.map((d) => ({ name: L(d.key), count: d.count }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={AXIS} />
              <YAxis allowDecimals={false} tick={AXIS} />
              <Tooltip />
              <Bar
                dataKey="count"
                fill="var(--signal-red)"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </Chart>
          <Chart title={t('improvement')}>
            <LineChart data={a.improvement}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="attempt" tick={AXIS} />
              <YAxis tick={AXIS} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="avg_score"
                stroke="var(--evac-green)"
                strokeWidth={3}
                dot
                isAnimationActive={false}
              />
            </LineChart>
          </Chart>
          <section className="bg-card rounded-lg border p-5 lg:col-span-2">
            <h2 className="mb-3 text-lg font-bold">{t('prePost')}</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label={`${t('firstAttempt')} · score`} value={a.pre_post.first_avg ?? '—'} />
              <Stat label={`${t('latestAttempt')} · score`} value={a.pre_post.latest_avg ?? '—'} />
              <Stat label={`${t('firstAttempt')} · ★`} value={a.pre_post.first_stars ?? '—'} />
              <Stat label={`${t('latestAttempt')} · ★`} value={a.pre_post.latest_stars ?? '—'} />
              <Stat
                label={t('passRate')}
                value={a.pass_rate === null ? '—' : `${Math.round(a.pass_rate * 100)}%`}
              />
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted rounded-lg p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-2xl font-bold">{value}</dd>
    </div>
  );
}
