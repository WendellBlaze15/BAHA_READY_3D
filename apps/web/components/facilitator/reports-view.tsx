'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useMyOwnedGroups } from '@/lib/data/facilitator';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { Button } from '@/components/ui/button';
import { NoGroups } from './no-groups';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function ReportsView() {
  const t = useTranslations('fac');
  const format = useFormatter();
  const errText = useApiErrorText();
  const groups = useMyOwnedGroups();
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const gid = group || groups.data?.[0]?.id || '';

  // Job rows update live (RealtimeProvider: report_jobs → invalidate qk.facilitator.reports()).
  const jobs = useQuery({
    queryKey: qk.facilitator.reports(),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('report_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });

  const run = async (type: 'group_csv' | 'group_pdf') => {
    setBusy(type);
    const id = toast.loading(t('generating'));
    try {
      await apiPost('/api/reports', { type, group_id: gid });
      toast.success(t('ready'), { id });
      void jobs.refetch();
    } catch (e) {
      toast.error(errText(e), { id });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('reportsTitle')}</h1>
      {groups.isSuccess && !groups.data?.length && <NoGroups />}
      <div className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <Select value={gid} onValueChange={setGroup}>
          <SelectTrigger className="h-11 w-56" aria-label={t('chooseGroup')}>
            <SelectValue placeholder={t('chooseGroup')} />
          </SelectTrigger>
          <SelectContent>
            {(groups.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={!gid || !!busy}
          onClick={() => void run('group_csv')}
        >
          {busy === 'group_csv' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet aria-hidden />
          )}{' '}
          {t('exportCsv')}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={!gid || !!busy}
          onClick={() => void run('group_pdf')}
        >
          {busy === 'group_pdf' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <FileText aria-hidden />
          )}{' '}
          {t('exportPdf')}
        </Button>
      </div>
      <ul className="bg-card divide-y rounded-lg border">
        {!jobs.data?.length && <li className="text-muted-foreground p-4">{t('noReports')}</li>}
        {jobs.data?.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="font-bold uppercase">{j.type.replace('group_', '')}</span>
            <span className="text-muted-foreground text-sm">
              {format.relativeTime(new Date(j.created_at))}
            </span>
            <span className="ml-auto text-sm">
              {j.status === 'ready' ? (
                <Button asChild size="sm" className="min-h-10">
                  <a href={`/api/reports/${j.id}/download`}>
                    <Download aria-hidden /> {t('download')}
                  </a>
                </Button>
              ) : j.status === 'failed' ? (
                <span className="text-destructive">✕</span>
              ) : (
                <Loader2 className="size-4 animate-spin" aria-label={t('generating')} />
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
