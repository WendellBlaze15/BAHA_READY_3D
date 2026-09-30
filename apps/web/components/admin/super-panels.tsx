'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Save, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { ReauthDialog } from '@/components/auth/reauth-dialog';
import { SkeletonCard, SkeletonStat } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { QueryError } from '@/components/query-error';
import { UsersAdmin } from './users-admin';

/** Admin management: the users table + promote/demote with step-up re-auth. */
export function AdminsManager() {
  const t = useTranslations('super');
  const errText = useApiErrorText();
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ id: string; make: boolean } | null>(null);
  return (
    <>
      <UsersAdmin
        extraAction={(u) =>
          u.roles.includes('super_admin') ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-10"
              onClick={() => setPending({ id: u.id, make: !u.roles.includes('admin') })}
            >
              <UserCog aria-hidden />{' '}
              {u.roles.includes('admin') ? t('removeAdmin') : t('makeAdmin')}
            </Button>
          )
        }
      />
      <ReauthDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        hasTotp
        emailDeliverable={false}
        onConfirmed={async () => {
          if (!pending) return;
          try {
            await apiPost('/api/super/admins', { user_id: pending.id, make_admin: pending.make });
            toast.success(t('promoted'));
            void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
          } catch (e) {
            toast.error(errText(e));
          }
          setPending(null);
        }}
      />
    </>
  );
}

type Setting = { key: string; value: unknown };

export function SystemSettings() {
  const t = useTranslations('super');
  const qc = useQueryClient();
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: qk.admin.settings(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('system_settings')
        .select('key, value');
      if (error) throw error;
      return Object.fromEntries((data as Setting[]).map((s) => [s.key, s.value])) as Record<
        string,
        unknown
      >;
    },
  });
  const [maint, setMaint] = useState({ enabled: false, message_fil: '', message_en: '' });
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setMaint({ enabled: false, message_fil: '', message_en: '', ...(data.maintenance as object) });
    setFlags((data.feature_flags as Record<string, boolean>) ?? {});
    setLimits(JSON.stringify(data.rate_limits ?? {}, null, 2));
  }, [data]);

  const save = async (key: string, value: unknown) => {
    setBusy(key);
    const { error } = await getSupabaseBrowser()
      .from('system_settings')
      .update({ value: value as never })
      .eq('key', key);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success('✓');
    void qc.invalidateQueries({ queryKey: qk.admin.settings() });
  };

  if (error)
    return <QueryError error={error} retrying={isFetching} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonCard className="h-96" />;
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('systemTitle')}</h1>
      <section className="bg-card space-y-3 rounded-lg border p-5">
        <div className="flex min-h-11 items-center justify-between">
          <Label htmlFor="maint" className="text-lg font-bold">
            {t('maintenance')}
          </Label>
          <Switch
            id="maint"
            checked={maint.enabled}
            onCheckedChange={(v) => setMaint({ ...maint, enabled: v })}
          />
        </div>
        <Textarea
          aria-label={t('maintenanceMsgFil')}
          placeholder={t('maintenanceMsgFil')}
          value={maint.message_fil}
          onChange={(e) => setMaint({ ...maint, message_fil: e.target.value })}
        />
        <Textarea
          aria-label={t('maintenanceMsgEn')}
          placeholder={t('maintenanceMsgEn')}
          value={maint.message_en}
          onChange={(e) => setMaint({ ...maint, message_en: e.target.value })}
        />
        <Button
          className="min-h-11"
          disabled={busy === 'maintenance'}
          onClick={() => void save('maintenance', maint)}
        >
          <Save aria-hidden /> Save
        </Button>
      </section>
      <section className="bg-card space-y-3 rounded-lg border p-5">
        <div className="flex min-h-11 items-center justify-between">
          <div>
            <Label htmlFor="mfa" className="text-lg font-bold">
              {t('requireMfa')}
            </Label>
            <p className="text-signal-red text-sm">{t('requireMfaWarn')}</p>
          </div>
          <Switch
            id="mfa"
            checked={data.require_staff_mfa !== false}
            onCheckedChange={(v) => void save('require_staff_mfa', v)}
          />
        </div>
      </section>
      <section className="bg-card space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-bold">{t('flags')}</h2>
        {Object.entries(flags).map(([k, v]) => (
          <div key={k} className="flex min-h-11 items-center justify-between">
            <Label htmlFor={`ff-${k}`}>{k}</Label>
            <Switch
              id={`ff-${k}`}
              checked={v}
              onCheckedChange={(nv) => setFlags({ ...flags, [k]: nv })}
            />
          </div>
        ))}
        <Button
          className="min-h-11"
          disabled={busy === 'feature_flags'}
          onClick={() => void save('feature_flags', flags)}
        >
          <Save aria-hidden /> Save
        </Button>
      </section>
      <section className="bg-card space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-bold">{t('rateLimits')}</h2>
        <Textarea
          rows={16}
          className="font-mono text-xs"
          value={limits}
          onChange={(e) => setLimits(e.target.value)}
          aria-label={t('rateLimits')}
        />
        <Button
          className="min-h-11"
          disabled={busy === 'rate_limits'}
          onClick={() => {
            try {
              void save('rate_limits', JSON.parse(limits));
            } catch {
              toast.error(t('invalidJson'));
            }
          }}
        >
          <Save aria-hidden /> Save
        </Button>
      </section>
    </div>
  );
}

type Sec = {
  active_sessions: number;
  sessions_by_aal: Record<string, number>;
  mfa_enrolled_staff: number;
  staff_total: number;
  suspended: number;
  flagged_7d: number;
  flag_reasons: Record<string, number>;
  recent_role_changes: {
    action: string;
    actor_role: string;
    target_id: string;
    created_at: string;
  }[];
  recent_suspensions: { action: string; target_id: string; created_at: string }[];
};

export function SecurityCenter() {
  const t = useTranslations('super');
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: qk.admin.security(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().rpc('security_overview');
      if (error) throw error;
      return data as unknown as Sec;
    },
    refetchInterval: 60_000,
  });
  if (error)
    return <QueryError error={error} retrying={isFetching} onRetry={() => void refetch()} />;
  if (isPending || !data)
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>
    );
  const mfaOk = data.mfa_enrolled_staff >= data.staff_total;
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('securityTitle')}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Box label={t('activeSessions')} value={data.active_sessions} />
        <Box
          label={t('staffMfa')}
          value={`${data.mfa_enrolled_staff}/${data.staff_total}`}
          icon={
            mfaOk ? (
              <ShieldCheck className="text-evac-green size-5" aria-hidden />
            ) : (
              <ShieldAlert className="text-signal-red size-5" aria-hidden />
            )
          }
        />
        <Box label={t('suspendedUsers')} value={data.suspended} />
        <Box label={t('flagged7d')} value={data.flagged_7d} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <List
          title={t('flagReasons')}
          rows={Object.entries(data.flag_reasons).map(([k, v]) => `${k}: ${v}`)}
        />
        <List
          title={t('recentRoles')}
          rows={data.recent_role_changes.map(
            (r) => `${r.created_at.slice(0, 16)} · ${r.action} · ${r.actor_role ?? 'system'}`,
          )}
        />
        <List
          title={t('recentActions')}
          rows={data.recent_suspensions.map((r) => `${r.created_at.slice(0, 16)} · ${r.action}`)}
        />
      </div>
    </div>
  );
}

function Box({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        {icon} {label}
      </p>
      <p className="font-display text-3xl font-bold">{value}</p>
    </div>
  );
}

function List({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-2 font-bold">{title}</h2>
      {rows.length ? (
        <ul className="space-y-1 font-mono text-xs">
          {rows.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">—</p>
      )}
    </section>
  );
}
