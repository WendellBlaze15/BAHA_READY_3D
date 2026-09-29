'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api/client';
import { useCountdown } from '@/hooks/use-countdown';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OtpCodeField } from './otp-code-field';
import { useApiErrorText, useFieldErrorText } from './use-api-error';

/**
 * Step-up re-authentication (fresh proof within 5 min) before sensitive actions.
 * Calls onConfirmed() once the server has recorded the re-auth.
 */
export function ReauthDialog({
  open,
  onOpenChange,
  onConfirmed,
  hasTotp,
  emailDeliverable = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirmed: () => void | Promise<void>;
  hasTotp: boolean;
  emailDeliverable?: boolean;
}) {
  const t = useTranslations('reauth');
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const ids = { code: useId(), pw: useId(), err: useId() };
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cooldown = useCountdown();

  async function run(body: Record<string, string>) {
    setBusy(true);
    setError(undefined);
    try {
      await apiPost('/api/auth/reauth', body);
      if (body.method === 'otp_request') {
        setSent(true);
        cooldown.start(60);
      } else {
        onOpenChange(false);
        setCode('');
        setPassword('');
        await onConfirmed();
      }
    } catch (e) {
      const f =
        e instanceof ApiClientError
          ? (e.fields.token ?? e.fields.code ?? e.fields.password)
          : undefined;
      setError(f ? fieldText(f) : errText(e));
      if (e instanceof ApiClientError && e.retryAfter) cooldown.start(e.retryAfter);
    } finally {
      setBusy(false);
    }
  }

  const defaultTab = hasTotp ? 'totp' : emailDeliverable ? 'email' : 'password';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl">{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={defaultTab} className="gap-4" onValueChange={() => setError(undefined)}>
          <TabsList
            className="grid h-11 w-full"
            style={{
              gridTemplateColumns: `repeat(${[emailDeliverable, hasTotp, true].filter(Boolean).length}, 1fr)`,
            }}
          >
            {emailDeliverable && <TabsTrigger value="email">{t('methodEmail')}</TabsTrigger>}
            {hasTotp && <TabsTrigger value="totp">{t('methodTotp')}</TabsTrigger>}
            <TabsTrigger value="password">{t('methodPassword')}</TabsTrigger>
          </TabsList>
          {emailDeliverable && (
            <TabsContent value="email" className="space-y-3">
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={busy || cooldown.remaining > 0}
                onClick={() => void run({ method: 'otp_request' })}
              >
                {cooldown.remaining > 0
                  ? `${t('sendCode')} (${cooldown.remaining}s)`
                  : t('sendCode')}
              </Button>
              {sent && (
                <>
                  <Label htmlFor={ids.code}>6-digit code</Label>
                  <OtpCodeField
                    id={ids.code}
                    label="6-digit code"
                    value={code}
                    onChange={setCode}
                    onComplete={(v) => void run({ method: 'otp', token: v })}
                    disabled={busy}
                  />
                </>
              )}
            </TabsContent>
          )}
          {hasTotp && (
            <TabsContent value="totp" className="space-y-3">
              <OtpCodeField
                id={`${ids.code}-totp`}
                label="Authenticator code"
                value={code}
                onChange={setCode}
                onComplete={(v) => void run({ method: 'totp', code: v })}
                disabled={busy}
              />
            </TabsContent>
          )}
          <TabsContent value="password">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (password) void run({ method: 'password', password });
              }}
            >
              <Input
                id={ids.pw}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12"
                aria-label={t('methodPassword')}
              />
              <Button type="submit" className="min-h-11 w-full" disabled={busy || !password}>
                {busy && <Loader2 className="animate-spin" aria-hidden />} {t('confirm')}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        {error && (
          <p id={ids.err} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
