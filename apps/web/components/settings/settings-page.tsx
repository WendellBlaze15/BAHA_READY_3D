'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Check, Download, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { apiPost } from '@/lib/api/client';
import { enablePush } from '@/lib/push/push-client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import {
  useProfile,
  useSettings,
  useUpdateProfile,
  useUpdateSettings,
  type SettingsRow,
} from '@/lib/data/me';
import { ReauthDialog } from '@/components/auth/reauth-dialog';
import { PasswordStrengthMeter, usePasswordScore } from '@/components/auth/password-strength-meter';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { Skeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type Audio = { master: number; music: number; sfx: number; voice: number };
type Controls = { joystickSize: 'sm' | 'md' | 'lg'; invertCamera: boolean };
type Notif = {
  email: boolean;
  push: boolean;
  dailyReminder: boolean;
  dailyReminderTime: string;
  marketing?: boolean;
};
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Batches patches and saves 500ms after the last change. */
function useAutoSave() {
  const update = useUpdateSettings();
  const pending = useRef<Partial<SettingsRow>>({});
  const timer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<SaveState>('idle');

  const flush = useCallback(() => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setState('saving');
    update.mutate(patch, {
      onSuccess: () => setState('saved'),
      onError: () => setState('error'),
    });
  }, [update]);

  const save = useCallback(
    (patch: Partial<SettingsRow>, immediate = false) => {
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      if (immediate) flush();
      else timer.current = window.setTimeout(flush, 500);
    },
    [flush],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { save, state };
}

export function SettingsPage() {
  const t = useTranslations('settingsPage');
  const tp = useTranslations('pwa');
  const tc = useTranslations('common');
  const { data: settings } = useSettings();
  const { data: profile } = useProfile();
  const { save, state } = useAutoSave();
  const [local, setLocal] = useState<SettingsRow | undefined>(settings ?? undefined);
  useEffect(() => setLocal(settings ?? undefined), [settings]);

  if (!local || !profile) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6" aria-busy="true">
        <Skeleton className="h-9 w-40" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const set = <K extends keyof SettingsRow>(k: K, v: SettingsRow[K], immediate = false) => {
    setLocal((s) => (s ? { ...s, [k]: v } : s));
    save({ [k]: v } as Partial<SettingsRow>, immediate);
  };
  const audio = local.audio as Audio;
  const controls = local.controls as Controls;
  const notif = local.notifications as Notif;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <SaveIndicator state={state} />
      </div>

      <Section title={t('displayTitle')}>
        <LanguageRow />
        <Row label={tc('theme')}>
          <ThemeRadio value={local.theme} onChange={(v) => set('theme', v, true)} />
        </Row>
        <Row
          label={t('textSize')}
          hint={t('textSizeValue', { percent: Math.round(Number(local.text_scale) * 100) })}
        >
          <Slider
            className="w-full max-w-xs"
            min={100}
            max={150}
            step={10}
            value={[Math.round(Number(local.text_scale) * 100)]}
            onValueChange={([v]) => set('text_scale', (v ?? 100) / 100)}
            aria-label={t('textSize')}
          />
        </Row>
        <ToggleRow
          label={t('reducedMotion')}
          checked={local.reduced_motion}
          onChange={(v) => set('reduced_motion', v, true)}
        />
      </Section>

      <Section title={t('graphicsTitle')} hint={t('graphicsHint')}>
        <RadioGroup
          value={local.graphics_quality}
          onValueChange={(v) => set('graphics_quality', v, true)}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label={t('graphicsTitle')}
        >
          {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
            <Label
              key={q}
              htmlFor={`q-${q}`}
              className="bg-background flex min-h-11 items-center gap-2 rounded-lg border px-3"
            >
              <RadioGroupItem id={`q-${q}`} value={q} /> {t(`quality.${q}`)}
            </Label>
          ))}
        </RadioGroup>
        <OfflineDownload />
      </Section>

      <Section title={t('audioTitle')}>
        {(['master', 'music', 'sfx', 'voice'] as const).map((k) => (
          <Row key={k} label={t(`audio.${k}`)} hint={`${Math.round((audio[k] ?? 0) * 100)}%`}>
            <Slider
              className="w-full max-w-xs"
              min={0}
              max={100}
              step={5}
              value={[Math.round((audio[k] ?? 0) * 100)]}
              onValueChange={([v]) => set('audio', { ...audio, [k]: (v ?? 0) / 100 })}
              aria-label={t(`audio.${k}`)}
            />
          </Row>
        ))}
      </Section>

      <Section title={t('controlsTitle')}>
        <Row label={t('joystickSize')}>
          <RadioGroup
            value={controls.joystickSize}
            onValueChange={(v) =>
              set('controls', { ...controls, joystickSize: v as Controls['joystickSize'] }, true)
            }
            className="flex flex-wrap gap-2"
          >
            {(['sm', 'md', 'lg'] as const).map((s) => (
              <Label
                key={s}
                htmlFor={`js-${s}`}
                className="bg-background flex min-h-11 items-center gap-2 rounded-lg border px-3"
              >
                <RadioGroupItem id={`js-${s}`} value={s} /> {t(`joystick.${s}`)}
              </Label>
            ))}
          </RadioGroup>
        </Row>
        <ToggleRow
          label={t('invertCamera')}
          checked={controls.invertCamera}
          onChange={(v) => set('controls', { ...controls, invertCamera: v }, true)}
        />
      </Section>

      <Section title={t('notificationsTitle')} hint={t('notifSecurityNote')}>
        <ToggleRow
          label={t('notifEmail')}
          checked={notif.email}
          onChange={(v) => set('notifications', { ...notif, email: v }, true)}
        />
        <ToggleRow
          label={t('notifPush')}
          checked={notif.push}
          onChange={async (v) => {
            if (v) {
              const res = await enablePush().catch(() => 'unsupported' as const);
              if (res !== 'enabled') {
                toast.error(tp(res === 'denied' ? 'pushDenied' : 'pushUnsupported'));
                return;
              }
            }
            set('notifications', { ...notif, push: v }, true);
          }}
        />
        <ToggleRow
          label={t('notifDaily')}
          checked={notif.dailyReminder}
          onChange={(v) => set('notifications', { ...notif, dailyReminder: v }, true)}
        />
        {notif.dailyReminder && (
          <Row label={t('notifDailyTime')}>
            <Input
              type="time"
              value={notif.dailyReminderTime}
              onChange={(e) =>
                set('notifications', { ...notif, dailyReminderTime: e.target.value })
              }
              className="h-11 w-36"
              aria-label={t('notifDailyTime')}
            />
          </Row>
        )}
      </Section>

      <Section title={t('privacyTitle')}>
        <LeaderboardToggle />
      </Section>

      <AccountSection username={profile.username as string} />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations('settingsPage');
  return (
    <p
      aria-live="polite"
      className="text-muted-foreground flex min-h-6 items-center gap-1.5 text-sm"
    >
      {state === 'saving' && (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('saving')}
        </>
      )}
      {state === 'saved' && (
        <>
          <Check className="text-evac-green size-4" aria-hidden /> {t('saved')}
        </>
      )}
      {state === 'error' && (
        <span className="text-destructive flex items-center gap-1.5">
          <TriangleAlert className="size-4" aria-hidden /> {t('saveFailed')}
        </span>
      )}
    </p>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-medium">
        {label}
        {hint && <span className="text-muted-foreground ml-2 tabular-nums">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = `t-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ThemeRadio({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tc = useTranslations('common');
  const { setTheme } = useTheme();
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => {
        setTheme(v);
        onChange(v);
      }}
      className="flex flex-wrap gap-2"
    >
      {(['system', 'light', 'dark'] as const).map((v) => (
        <Label
          key={v}
          htmlFor={`th-${v}`}
          className="bg-background flex min-h-11 items-center gap-2 rounded-lg border px-3"
        >
          <RadioGroupItem id={`th-${v}`} value={v} />
          {v === 'system' ? tc('themeSystem') : v === 'light' ? tc('themeLight') : tc('themeDark')}
        </Label>
      ))}
    </RadioGroup>
  );
}

function LanguageRow() {
  const t = useTranslations('settingsPage');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const update = useUpdateProfile();
  return (
    <Row label={t('language')}>
      <RadioGroup
        value={locale}
        onValueChange={(v) => {
          update.mutate({ language: v as 'fil' | 'en' });
          router.replace(pathname, { locale: v as 'fil' | 'en' });
        }}
        className="flex gap-2"
      >
        {(['fil', 'en'] as const).map((l) => (
          <Label
            key={l}
            htmlFor={`lang-set-${l}`}
            className="bg-background flex min-h-11 items-center gap-2 rounded-lg border px-3"
          >
            <RadioGroupItem id={`lang-set-${l}`} value={l} /> {l === 'fil' ? 'Filipino' : 'English'}
          </Label>
        ))}
      </RadioGroup>
    </Row>
  );
}

function LeaderboardToggle() {
  const t = useTranslations('settingsPage');
  const { data: profile } = useProfile();
  const update = useUpdateProfile();
  return (
    <ToggleRow
      label={t('leaderboardVisible')}
      checked={!!profile?.leaderboard_visible}
      onChange={(v) => update.mutate({ leaderboard_visible: v })}
    />
  );
}

type PendingAction = 'password' | 'export' | 'delete' | null;

function AccountSection({ username }: { username: string }) {
  const t = useTranslations('settingsPage');
  const errText = useApiErrorText();
  const router = useRouter();
  const [reauthOpen, setReauthOpen] = useState(false);
  const [action, setAction] = useState<PendingAction>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [exportUrl, setExportUrl] = useState<string>();
  const [busy, setBusy] = useState(false);

  const factors = useQuery({
    queryKey: qk.me.factors(),
    queryFn: async () => {
      const [{ data }, { data: session }] = await Promise.all([
        getSupabaseBrowser().auth.mfa.listFactors(),
        getSupabaseBrowser().auth.getSession(),
      ]);
      return {
        hasTotp: !!data?.totp.some((f) => f.status === 'verified'),
        emailDeliverable: !session.session?.user.email?.endsWith('@bahaready.internal'),
      };
    },
    staleTime: 60_000,
  });

  const start = (a: PendingAction) => {
    setAction(a);
    setReauthOpen(true);
  };

  async function afterReauth() {
    if (action === 'password') setPwOpen(true);
    if (action === 'export') {
      setBusy(true);
      try {
        const r = await apiPost<{ url: string }>('/api/account/export', {});
        setExportUrl(r.url);
        toast.success(t('exportReady'));
      } catch (e) {
        toast.error(errText(e));
      } finally {
        setBusy(false);
      }
    }
    if (action === 'delete') {
      setBusy(true);
      try {
        await apiPost('/api/account/delete', {});
        router.replace('/');
        router.refresh();
      } catch (e) {
        toast.error(errText(e));
        setBusy(false);
      }
    }
  }

  return (
    <section className="bg-card space-y-5 rounded-lg border p-5">
      <h2 className="text-xl font-bold">{t('accountTitle')}</h2>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4" aria-hidden /> {t('mfaTitle')}:{' '}
            {factors.data?.hasTotp ? t('mfaOn') : t('mfaOff')}
          </p>
        </div>
        {!factors.data?.hasTotp && (
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/mfa?next=/settings">{t('mfaSetup')}</Link>
          </Button>
        )}
      </div>

      <ActionRow title={t('setPassword')} hint={t('setPasswordHint')}>
        <Button variant="outline" className="min-h-11" onClick={() => start('password')}>
          {t('setPassword')}
        </Button>
      </ActionRow>

      <ActionRow title={t('exportData')} hint={t('exportHint')}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => start('export')}
          >
            {busy && action === 'export' && <Loader2 className="animate-spin" aria-hidden />}
            {t('exportData')}
          </Button>
          {exportUrl && (
            <Button asChild className="min-h-11">
              <a href={exportUrl} rel="noopener">
                <Download aria-hidden /> {t('download')}
              </a>
            </Button>
          )}
        </div>
      </ActionRow>

      <ActionRow title={t('signOutOthers')}>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={async () => {
            try {
              await apiPost('/api/auth/signout', { scope: 'others' });
              toast.success(t('signOutOthersDone'));
            } catch (e) {
              toast.error(errText(e));
            }
          }}
        >
          {t('signOutOthers')}
        </Button>
      </ActionRow>

      <ActionRow title={t('deleteAccount')} hint={t('deleteHint')} danger>
        <Button variant="destructive" className="min-h-11" onClick={() => setDeleteOpen(true)}>
          {t('deleteAccount')}
        </Button>
      </ActionRow>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirmBody')}</DialogDescription>
          </DialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            aria-label="username"
            className="h-11"
          />
          <DialogFooter>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={confirmName !== username}
              onClick={() => {
                setDeleteOpen(false);
                start('delete');
              }}
            >
              {t('deleteConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SetPasswordDialog open={pwOpen} onOpenChange={setPwOpen} />

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onConfirmed={afterReauth}
        hasTotp={!!factors.data?.hasTotp}
        emailDeliverable={factors.data?.emailDeliverable ?? true}
      />
    </section>
  );
}

function ActionRow({
  title,
  hint,
  danger,
  children,
}: {
  title: string;
  hint?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className={danger ? 'text-destructive font-bold' : 'font-medium'}>{title}</p>
        {hint && <p className="text-muted-foreground max-w-md text-sm">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function SetPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const errText = useApiErrorText();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const score = usePasswordScore(password);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t('settingsPage.setPassword')}</DialogTitle>
          <DialogDescription>{t('auth.newPasswordHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await apiPost('/api/account/password', { password });
              toast.success(t('settingsPage.passwordSaved'));
              setPassword('');
              onOpenChange(false);
            } catch (err) {
              toast.error(errText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12"
            aria-label={t('auth.newPasswordLabel')}
          />
          <PasswordStrengthMeter score={score} />
          <Button
            type="submit"
            className="min-h-11 w-full"
            disabled={busy || password.length < 10 || (score ?? 0) < 3}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />} {t('auth.savePassword')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const LEVEL_SLUGS = ['tutorial', 'signal-1', 'signal-2', 'signal-3', 'signal-4', 'signal-5'];

/** Warms the service-worker caches: the 3D engine chunk + every level page. */
function OfflineDownload() {
  const tp = useTranslations('pwa');
  const locale = useLocale();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  return (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        try {
          await import('@/game/scenes/GameCanvas');
          const prefix = locale === 'en' ? '/en' : '';
          await Promise.all(
            LEVEL_SLUGS.map((s) =>
              fetch(`${prefix}/play/${s}`, { credentials: 'same-origin' }).catch(() => null),
            ),
          );
          setState('done');
          toast.success(tp('downloaded'));
        } catch {
          setState('idle');
        }
      }}
    >
      {state === 'busy' ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Download aria-hidden />
      )}
      {state === 'busy'
        ? tp('downloading')
        : state === 'done'
          ? tp('downloaded')
          : tp('downloadLevels')}
    </Button>
  );
}
