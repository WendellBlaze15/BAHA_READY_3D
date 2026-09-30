'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { ApiClientError } from '@/lib/api/client';
import { useApiErrorText, useFieldErrorText } from '@/components/auth/use-api-error';
import { Honeypot } from '@/components/auth/honeypot';
import { SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ApplyPage() {
  const t = useTranslations('apply');
  const qc = useQueryClient();
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const honeypot = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [again, setAgain] = useState(false);

  // Updates live through RealtimeProvider (facilitator_applications changes → invalidate).
  const app = useQuery({
    queryKey: qk.me.application(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('facilitator_applications')
        .select('id, status, review_note, created_at, organization')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('website', honeypot.current?.value ?? '');
    const file = fd.get('proof');
    if (file instanceof File && file.size === 0) fd.delete('proof');
    setBusy(true);
    setFieldErrors({});
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const env = (await res.json()) as {
        error: {
          code: string;
          message: string;
          fields?: Record<string, string>;
          retry_after?: number;
        } | null;
      };
      if (!res.ok || env.error) throw new ApiClientError(env.error as never);
      toast.success(t('submitted'));
      setAgain(false);
      void qc.invalidateQueries({ queryKey: qk.me.application() });
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fields).length)
        setFieldErrors(err.fields);
      else toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (app.isPending) return <SkeletonCard className="h-64" />;
  const a = app.data;
  if (a && !again) {
    return (
      <section className="bg-card space-y-4 rounded-2xl border p-6" aria-live="polite">
        <h2 className="text-xl font-bold">{t('statusTitle')}</h2>
        {a.status === 'pending' && (
          <Status
            icon={<Clock className="text-signal-amber size-8" aria-hidden />}
            title={t('pending')}
            body={t('pendingBody')}
          />
        )}
        {a.status === 'approved' && (
          <>
            <Status
              icon={<CheckCircle2 className="text-evac-green size-8" aria-hidden />}
              title={t('approved')}
              body={t('approvedBody')}
            />
            <Button
              asChild
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
            >
              <Link href="/mfa?next=/facilitator">
                <ShieldCheck aria-hidden /> {t('goToFacilitator')}
              </Link>
            </Button>
          </>
        )}
        {a.status === 'rejected' && (
          <>
            <Status
              icon={<XCircle className="text-signal-red size-8" aria-hidden />}
              title={t('rejected')}
              body={t('rejectedBody', { note: a.review_note ?? '—' })}
            />
            <Button variant="outline" className="min-h-11" onClick={() => setAgain(true)}>
              {t('applyAgain')}
            </Button>
          </>
        )}
      </section>
    );
  }

  const field = (name: string, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        required
        className="h-12"
        aria-invalid={!!fieldErrors[name] || undefined}
        {...props}
      />
      {fieldErrors[name] && (
        <p className="text-destructive text-sm">{fieldText(fieldErrors[name])}</p>
      )}
    </div>
  );

  return (
    <form
      onSubmit={submit}
      className="bg-card space-y-4 rounded-2xl border p-6"
      encType="multipart/form-data"
    >
      <Honeypot ref={honeypot} />
      {field('full_name', t('fullName'), { maxLength: 120, autoComplete: 'name' })}
      {field('organization', t('organization'), { maxLength: 160, autoComplete: 'organization' })}
      {field('position', t('position'), { maxLength: 120 })}
      {field('contact', t('contact'), { maxLength: 120 })}
      <div className="space-y-1.5">
        <Label htmlFor="reason">{t('reason')}</Label>
        <Textarea
          id="reason"
          name="reason"
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          aria-invalid={!!fieldErrors.reason || undefined}
        />
        {fieldErrors.reason && (
          <p className="text-destructive text-sm">{fieldText(fieldErrors.reason)}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="proof">{t('proof')}</Label>
        <Input
          id="proof"
          name="proof"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="h-12 py-2.5"
        />
        {fieldErrors.proof && (
          <p className="text-destructive text-sm">{fieldText(fieldErrors.proof)}</p>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('privacy')}</p>
      <Button
        type="submit"
        disabled={busy}
        className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 w-full font-bold"
      >
        {busy && <Loader2 className="animate-spin" aria-hidden />} {t('submit')}
      </Button>
    </form>
  );
}

function Status({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-4">
      {icon}
      <div>
        <p className="text-lg font-bold">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
