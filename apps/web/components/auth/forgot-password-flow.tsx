'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MailCheck } from 'lucide-react';
import { emailSchema, PASSWORD_MIN } from '@baha/shared/auth';
import { useRouter } from '@/i18n/navigation';
import { apiPost, ApiClientError } from '@/lib/api/client';
import { useCountdown } from '@/hooks/use-countdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OtpCodeField } from './otp-code-field';
import { Honeypot } from './honeypot';
import { PasswordStrengthMeter, usePasswordScore } from './password-strength-meter';
import { useApiErrorText, useFieldErrorText } from './use-api-error';

export function ForgotPasswordFlow() {
  const t = useTranslations('auth');
  const router = useRouter();
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const ids = { email: useId(), code: useId(), pw: useId(), strength: useId(), err: useId() };
  const honeypot = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cooldown = useCountdown();
  const score = usePasswordScore(password, [email]);

  async function send(target: string) {
    const parsed = emailSchema.safeParse(target);
    if (!parsed.success) return setError(fieldText('errors.email_invalid'));
    setBusy(true);
    setError(undefined);
    try {
      const r = await apiPost<{ cooldown: number }>('/api/auth/password/forgot', {
        email: parsed.data,
        website: honeypot.current?.value ?? '',
      });
      cooldown.start(r.cooldown);
      setSentTo(parsed.data);
    } catch (e) {
      if (e instanceof ApiClientError && e.retryAfter) cooldown.start(e.retryAfter);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    if (code.length !== 6) return setError(fieldText('errors.otp_format'));
    if (password.length < PASSWORD_MIN) return setError(fieldText('errors.password_short'));
    if (score !== null && score < 3) return setError(fieldText('errors.password_weak'));
    setBusy(true);
    setError(undefined);
    try {
      const r = await apiPost<{ next: string }>('/api/auth/password/reset', {
        email: sentTo,
        token: code,
        password,
      });
      router.replace(r.next);
      router.refresh();
    } catch (err) {
      const f =
        err instanceof ApiClientError ? (err.fields.password ?? err.fields.token) : undefined;
      setError(f ? fieldText(f) : errText(err));
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(email);
        }}
      >
        <Honeypot ref={honeypot} />
        <div className="space-y-1.5">
          <Label htmlFor={ids.email}>{t('emailLabel')}</Label>
          <Input
            id={ids.email}
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? ids.err : undefined}
          />
        </div>
        {error && (
          <p id={ids.err} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="h-12 w-full text-base"
          disabled={busy || cooldown.remaining > 0}
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {cooldown.remaining > 0 ? t('resendIn', { seconds: cooldown.remaining }) : t('sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form noValidate className="space-y-4" onSubmit={reset}>
      <div className="bg-muted flex items-start gap-3 rounded-lg p-3">
        <MailCheck className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="text-sm">{t('codeSentTo', { email: sentTo })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.code}>{t('codeLabel')}</Label>
        <OtpCodeField
          id={ids.code}
          label={t('codeLabel')}
          value={code}
          onChange={setCode}
          disabled={busy}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.pw}>{t('newPasswordLabel')}</Label>
        <Input
          id={ids.pw}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 text-base"
          aria-describedby={`${ids.strength} ${error ? ids.err : ''}`}
        />
        <p className="text-muted-foreground text-xs">{t('newPasswordHint')}</p>
        <PasswordStrengthMeter id={ids.strength} score={score} />
      </div>
      {error && (
        <p id={ids.err} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" className="h-12 w-full text-base" disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {t('savePassword')}
      </Button>
      <Button
        type="button"
        variant="link"
        className="h-11 px-0"
        disabled={busy || cooldown.remaining > 0}
        onClick={() => void send(sentTo)}
      >
        {cooldown.remaining > 0 ? t('resendIn', { seconds: cooldown.remaining }) : t('resend')}
      </Button>
    </form>
  );
}
