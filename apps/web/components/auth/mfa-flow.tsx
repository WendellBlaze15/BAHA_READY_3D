'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Check, Copy, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { OtpCodeField } from './otp-code-field';
import { useFieldErrorText } from './use-api-error';

type State =
  | { kind: 'loading' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string };

/** TOTP enroll (first time) or challenge (returning), then continue to `next`. */
export function MfaFlow() {
  const t = useTranslations('mfa');
  const fieldText = useFieldErrorText();
  const router = useRouter();
  const params = useSearchParams();
  const ids = { code: useId(), err: useId() };
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === 'verified');
      if (verified) {
        if (!cancelled) setState({ kind: 'challenge', factorId: verified.id });
        return;
      }
      // Clean up abandoned, unverified enrollments before starting a new one.
      for (const f of data?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Baha Ready ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancelled) return;
      if (enrollErr || !enrolled) {
        setError(fieldText('errors.generic'));
        return;
      }
      setState({
        kind: 'enroll',
        factorId: enrolled.id,
        qr: enrolled.totp.qr_code,
        secret: enrolled.totp.secret,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldText]);

  async function verify(value: string) {
    if (state.kind === 'loading' || busy) return;
    setBusy(true);
    setError(undefined);
    const supabase = getSupabaseBrowser();
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: value,
    });
    if (err) {
      setCode('');
      setError(fieldText('errors.otp_invalid'));
      setBusy(false);
      return;
    }
    if (state.kind === 'enroll') toast.success(t('success'));
    const next = params.get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
    router.replace(safe);
    router.refresh();
  }

  if (state.kind === 'loading') {
    return (
      <div className="text-muted-foreground flex items-center gap-2" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('loading')}
        {error && <span className="text-destructive">{error}</span>}
      </div>
    );
  }

  const codeForm = (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) void verify(code);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={ids.code}>{t('step3')}</Label>
        <OtpCodeField
          id={ids.code}
          label={t('step3')}
          value={code}
          onChange={setCode}
          onComplete={(v) => void verify(v)}
          disabled={busy}
          invalid={!!error}
          describedBy={error ? ids.err : undefined}
        />
        {error && (
          <p id={ids.err} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" className="h-12 w-full text-base" disabled={busy || code.length !== 6}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
        {t('verifyAndContinue')}
      </Button>
    </form>
  );

  if (state.kind === 'challenge') {
    return (
      <div className="space-y-4">
        <p>{t('challengeLede')}</p>
        {codeForm}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">{t('setupLede')}</p>
      <ol className="list-decimal space-y-4 pl-5">
        <li>{t('step1')}</li>
        <li className="space-y-3">
          <span>{t('step2')}</span>
          {/* Supabase returns the QR as an SVG data URI generated locally (no third-party QR service). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.qr}
            alt="QR code"
            width={184}
            height={184}
            className="rounded-lg border bg-white p-2"
          />
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">{t('manualKey')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted rounded-sm px-2 py-1 font-mono text-sm break-all">
                {state.secret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.secret);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? t('copied') : t('copyKey')}
              </Button>
            </div>
          </div>
        </li>
        <li>{codeForm}</li>
      </ol>
    </div>
  );
}
