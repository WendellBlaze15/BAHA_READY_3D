'use client';

import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Loader2, Mail, MailCheck } from 'lucide-react';
import { emailSchema } from '@baha/shared/auth';
import { apiPost, ApiClientError } from '@/lib/api/client';
import { useCountdown } from '@/hooks/use-countdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OtpCodeField } from './otp-code-field';
import { Honeypot } from './honeypot';
import { useAuthTransition } from '@/lib/auth/auth-transition';
import { useApiErrorText, useFieldErrorText } from './use-api-error';

type Step = { kind: 'email' } | { kind: 'code'; email: string };

export function EmailOtpFlow({ mode }: { mode: 'signin' | 'signup' }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const authTransition = useAuthTransition();
  const params = useSearchParams();
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const ids = { email: useId(), emailErr: useId(), code: useId(), codeErr: useId() };
  const honeypot = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [attemptsLeft, setAttemptsLeft] = useState<number>();
  const cooldown = useCountdown();

  async function requestCode(target: string) {
    setError(undefined);
    const parsed = emailSchema.safeParse(target);
    if (!parsed.success) {
      setError(fieldText('errors.email_invalid'));
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ cooldown: number }>('/api/auth/otp/request', {
        email: parsed.data,
        mode,
        locale,
        website: honeypot.current?.value ?? '',
      });
      cooldown.start(res.cooldown);
      setStep({ kind: 'code', email: parsed.data });
      setCode('');
      setAttemptsLeft(undefined);
    } catch (e) {
      if (e instanceof ApiClientError && e.retryAfter) cooldown.start(e.retryAfter);
      setError(
        e instanceof ApiClientError && e.fields.email ? fieldText(e.fields.email) : errText(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(token: string) {
    if (step.kind !== 'code' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = params.get('next');
      const res = await apiPost<{ next: string }>(
        `/api/auth/otp/verify${next ? `?next=${encodeURIComponent(next)}` : ''}`,
        { email: step.email, token },
      );
      authTransition(res.next);
    } catch (e) {
      setCode('');
      if (e instanceof ApiClientError) {
        if (e.fields.attempts_left) setAttemptsLeft(Number(e.fields.attempts_left));
        setError(e.fields.token ? fieldText(e.fields.token) : errText(e));
      } else setError(errText(e));
      setBusy(false);
    }
  }

  if (step.kind === 'email') {
    return (
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void requestCode(email);
        }}
      >
        <Honeypot ref={honeypot} />
        <div className="space-y-1.5">
          <Label htmlFor={ids.email}>{t('emailLabel')}</Label>
          <div className="relative">
            <Mail
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? ids.emailErr : undefined}
              className="bg-background h-13 rounded-lg pl-11 text-base"
            />
          </div>
          {error && (
            <p id={ids.emailErr} role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <Button
          type="submit"
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 h-13 w-full rounded-lg text-base font-bold shadow-sm"
          disabled={busy || cooldown.remaining > 0}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {busy
            ? t('sending')
            : cooldown.remaining > 0
              ? t('resendIn', { seconds: cooldown.remaining })
              : t('sendCode')}
        </Button>
        {mode === 'signin' && <p className="text-muted-foreground text-sm">{t('signInHint')}</p>}
      </form>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) void verify(code);
      }}
    >
      <div className="bg-muted flex items-start gap-3 rounded-lg p-3">
        <MailCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-sm">{t('codeSentTo', { email: step.email })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.code}>{t('codeLabel')}</Label>
        <OtpCodeField
          id={ids.code}
          label={t('codeLabel')}
          value={code}
          onChange={setCode}
          onComplete={(v) => void verify(v)}
          disabled={busy}
          invalid={!!error}
          describedBy={error ? ids.codeErr : undefined}
        />
        {error && (
          <p id={ids.codeErr} role="alert" className="text-destructive text-sm">
            {error}
            {attemptsLeft !== undefined &&
              attemptsLeft > 0 &&
              ` ${t('attemptsLeft', { count: attemptsLeft })}`}
          </p>
        )}
      </div>
      <Button
        type="submit"
        className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 h-13 w-full rounded-lg text-base font-bold shadow-sm"
        disabled={busy || code.length !== 6}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {busy ? t('verifying') : t('verify')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button
          type="button"
          variant="link"
          className="h-11 px-0"
          disabled={busy || cooldown.remaining > 0}
          onClick={() => void requestCode(step.email)}
        >
          {cooldown.remaining > 0 ? t('resendIn', { seconds: cooldown.remaining }) : t('resend')}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-11 px-0"
          onClick={() => {
            setStep({ kind: 'email' });
            setError(undefined);
          }}
        >
          {t('changeEmail')}
        </Button>
      </div>
    </form>
  );
}
