'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, FileText, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { useRelativeTime } from '@/lib/i18n/use-relative-time';
import { Textarea } from '@/components/ui/textarea';

type App = {
  id: string;
  full_name: string;
  organization: string;
  position: string;
  contact: string;
  reason: string;
  proof_path: string | null;
  created_at: string;
};

/** Oldest-first queue; approvals go through the approve-facilitator Edge Function. */
export function ApplicationsQueue() {
  const t = useTranslations('admin');
  const relTime = useRelativeTime();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isPending } = useQuery({
    queryKey: qk.admin.applications('pending'),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('facilitator_applications')
        .select('*')
        .eq('status', 'pending')
        .order('created_at');
      if (error) throw error;
      return data as App[];
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const decide = async (a: App, decision: 'approve' | 'reject') => {
    setBusy(a.id);
    const { data: res, error } = await getSupabaseBrowser().functions.invoke(
      'approve-facilitator',
      {
        body: { application_id: a.id, decision, note: notes[a.id]?.trim() || undefined },
      },
    );
    setBusy(null);
    const envErr = (res as { error?: { message: string } } | null)?.error;
    if (error || envErr) {
      const ctx = (error as { context?: Response } | null)?.context;
      const body = ctx ? await ctx.json().catch(() => null) : null;
      return toast.error(body?.error?.message ?? envErr?.message ?? 'Error');
    }
    toast.success(t('reviewed'));
    void qc.invalidateQueries({ queryKey: ['admin', 'applications'] });
    void qc.invalidateQueries({ queryKey: qk.admin.kpis() });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">
        {t('applicationsTitle')}{' '}
        {data?.length ? (
          <span className="bg-signal-red ml-2 rounded-full px-3 text-2xl text-white">
            {data.length}
          </span>
        ) : null}
      </h1>
      {isPending ? (
        <SkeletonCard className="h-48" />
      ) : !data?.length ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-6">{t('noApplications')}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id} className="bg-card space-y-3 rounded-lg border p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xl font-bold">{a.full_name}</p>
                  <p className="text-muted-foreground">
                    {a.position} · {a.organization}
                  </p>
                  <p className="text-muted-foreground text-sm">{a.contact}</p>
                </div>
                <span className="text-muted-foreground text-xs">
                  {t('submitted')} {relTime(a.created_at)}
                </span>
              </div>
              <p className="bg-muted rounded-lg p-3 text-sm whitespace-pre-line">{a.reason}</p>
              {a.proof_path && (
                <Button asChild variant="outline" size="sm" className="min-h-10">
                  <a
                    href={`/api/admin/applications/${a.id}/proof`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText aria-hidden /> {t('viewProof')}
                  </a>
                </Button>
              )}
              <Textarea
                placeholder={t('rejectReason')}
                aria-label={t('rejectReason')}
                value={notes[a.id] ?? ''}
                maxLength={1000}
                onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  className="bg-evac-green min-h-11 text-white"
                  disabled={busy === a.id}
                  onClick={() => void decide(a, 'approve')}
                >
                  {busy === a.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Check aria-hidden />
                  )}{' '}
                  {t('approve')}
                </Button>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={busy === a.id || (notes[a.id]?.trim().length ?? 0) < 3}
                  onClick={() => void decide(a, 'reject')}
                >
                  <X aria-hidden /> {t('reject')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
