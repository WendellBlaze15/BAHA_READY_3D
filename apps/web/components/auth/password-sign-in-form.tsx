'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { apiPost, ApiClientError } from '@/lib/api/client';
import { useCountdown } from '@/hooks/use-countdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Honeypot } from './honeypot';
import { useAuthTransition } from '@/lib/auth/auth-transition';
import { useApiErrorText, useFieldErrorText } from './use-api-error';

export function PasswordSignInForm() {
  const t = useTranslations('auth');
  const authTransition = useAuthTransition();
  const params = useSearchParams();
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const ids = { id: useId(), pw: useId(), err: useId() };
  const honeypot = useRef<HTMLInputElement>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useCountdown();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError(fieldText('errors.required'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const next = params.get('next');
      const res = await apiPost<{ next: string }>(
        `/api/auth/password${next ? `?next=${encodeURIComponent(next)}` : ''}`,
        { identifier: identifier.trim(), password, website: honeypot.current?.value ?? '' },
      );
      authTransition(res.next);
    } catch (err) {
      if (err instanceof ApiClientError && err.retryAfter) lock.start(err.retryAfter);
      setError(
        err instanceof ApiClientError && err.fields.password
          ? fieldText(err.fields.password)
          : errText(err),
      );
      setBusy(false);
    }
  }

  return (
    <form noValidate className="space-y-4" onSubmit={submit}>
      <Honeypot ref={honeypot} />
      <div className="space-y-1.5">
        <Label htmlFor={ids.id}>{t('identifierLabel')}</Label>
        <Input
          id={ids.id}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="bg-background h-13 rounded-lg text-base"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? ids.err : undefined}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={ids.pw}>{t('passwordLabel')}</Label>
          <Link href="/forgot-password" className="text-link text-sm underline">
            {t('forgotPassword')}
          </Link>
        </div>
        <div className="relative">
          <Input
            id={ids.pw}
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-background h-13 rounded-lg pr-12 text-base"
            aria-invalid={!!error || undefined}
            aria-describedby={error ? ids.err : undefined}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1 right-1 size-11"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
          >
            {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
      </div>
      {error && (
        <p id={ids.err} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 h-13 w-full rounded-lg text-base font-bold shadow-sm"
        disabled={busy || lock.remaining > 0}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {lock.remaining > 0 ? t('resendIn', { seconds: lock.remaining }) : t('signInWithPassword')}
      </Button>
    </form>
  );
}
