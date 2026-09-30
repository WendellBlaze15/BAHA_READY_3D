'use client';

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
import { Activity, AlertTriangle, Flag, Mail, UserPlus, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { QueryError } from '@/components/query-error';
import { SkeletonChart, SkeletonStat } from '@/components/skeletons';

type Kpis = {
  dau: number;
  wau: number;
  users: number;
  signups_7d: number;
  attempts: number;
  attempts_7d: number;
  flagged: number;
  pending_applications: number;
  email_failed: number;
  email_queued: number;
  pass_rate: { level_id: number; rate: number; n: number }[];
  daily: { day: string; attempts: number; players: number }[];
};

const AXIS = { fontSize: 12, fill: 'var(--muted-foreground)' };

export function AdminDashboard({
  levels,
}: {
  levels: { id: number; name_fil: string; name_en: string }[];
}) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: qk.admin.kpis(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().rpc('admin_kpis');
      if (error) throw error;
      return data as unknown as Kpis;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const lvl = (id: number) => {
    const l = levels.find((x) => x.id === id);
    return l ? (locale === 'en' ? l.name_en : l.name_fil) : `#${id}`;
  };

  const cards = data
    ? [
        { icon: Activity, label: t('dau'), value: data.dau },
        { icon: Activity, label: t('wau'), value: data.wau },
        { icon: Users, label: t('users'), value: data.users },
        { icon: UserPlus, label: t('signups'), value: data.signups_7d },
        {
          icon: Flag,
          label: t('flagged'),
          value: data.flagged,
          href: '/admin/moderation',
          warn: data.flagged > 0,
        },
        {
          icon: AlertTriangle,
          label: t('pendingApps'),
          value: data.pending_applications,
          href: '/admin/applications',
          warn: data.pending_applications > 0,
        },
        {
          icon: Mail,
          label: t('emailFailed'),
          value: data.email_failed,
          warn: data.email_failed > 0,
        },
        { icon: Mail, label: t('emailQueued'), value: data.email_queued },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">{t('dashboardTitle')}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {isPending
          ? Array.from({ length: 8 }, (_, i) => <SkeletonStat key={i} />)
          : cards.map((c) => {
              const inner = (
                <>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <c.icon className="size-4" aria-hidden /> {c.label}
                  </p>
                  <p
                    className={`font-display text-3xl font-bold tabular-nums ${c.warn ? 'text-signal-red' : ''}`}
                  >
                    {c.value}
                  </p>
                </>
              );
              return c.href ? (
                <Link
                  key={c.label}
                  href={c.href}
                  className="bg-card hover:border-primary rounded-lg border p-4"
                >
                  {inner}
                </Link>
              ) : (
                <div key={c.label} className="bg-card rounded-lg border p-4">
                  {inner}
                </div>
              );
            })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {error ? (
          <QueryError error={error} retrying={isFetching} onRetry={() => void refetch()} />
        ) : isPending || !data ? (
          <>
            <SkeletonChart />
            <SkeletonChart />
          </>
        ) : (
          <>
            <section className="bg-card rounded-lg border p-4">
              <h2 className="mb-3 text-lg font-bold">{t('daily')}</h2>
              <div className="h-60">
                <ResponsiveContainer>
                  <LineChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="day" tick={AXIS} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis allowDecimals={false} tick={AXIS} />
                    <Tooltip />
                    <Line
                      dataKey="attempts"
                      stroke="var(--lake)"
                      strokeWidth={3}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="players"
                      stroke="var(--signal-amber)"
                      strokeWidth={3}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="bg-card rounded-lg border p-4">
              <h2 className="mb-3 text-lg font-bold">{t('passRate')}</h2>
              <div className="h-60">
                <ResponsiveContainer>
                  <BarChart
                    data={data.pass_rate.map((p) => ({
                      name: lvl(p.level_id),
                      rate: Math.round(p.rate * 100),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={AXIS} />
                    <YAxis unit="%" domain={[0, 100]} tick={AXIS} />
                    <Tooltip />
                    <Bar
                      dataKey="rate"
                      fill="var(--evac-green)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
