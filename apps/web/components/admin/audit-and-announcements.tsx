'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { SkeletonTableRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function SystemAnnouncement() {
  const t = useTranslations('admin');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">{t('announcementsTitle')}</h1>
      <form
        className="bg-card max-w-2xl space-y-3 rounded-lg border p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const { data: s } = await getSupabaseBrowser().auth.getSession();
          const { error } = await getSupabaseBrowser()
            .from('announcements')
            .insert({
              scope: 'system',
              title: title.trim(),
              body: body.trim(),
              created_by: s.session?.user.id,
            });
          setBusy(false);
          if (error) return toast.error(error.message);
          toast.success(t('done'));
          setTitle('');
          setBody('');
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          aria-label="Title"
          placeholder="Title"
          className="h-11"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={5}
          aria-label="Message"
          placeholder="Message"
        />
        <Button
          type="submit"
          disabled={busy || title.trim().length < 2 || !body.trim()}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-11 font-bold"
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}{' '}
          {t('postToAll')}
        </Button>
      </form>
    </div>
  );
}

type Log = {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  ip: string | null;
  created_at: string;
};

export function AuditLogs() {
  const t = useTranslations('admin');
  const format = useFormatter();
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const { data, isPending } = useQuery({
    queryKey: qk.admin.audit({ filter, page }),
    queryFn: async () => {
      let q = getSupabaseBrowser()
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .range(page * 50, page * 50 + 49);
      if (filter) q = q.ilike('action', `%${filter}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as Log[];
    },
    placeholderData: keepPreviousData,
  });
  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">{t('auditTitle')}</h1>
      <Input
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setPage(0);
        }}
        placeholder={t('filterAction')}
        aria-label={t('filterAction')}
        className="h-11 max-w-sm"
      />
      <div className="bg-card overflow-x-auto rounded-lg border">
        {isPending ? (
          Array.from({ length: 10 }, (_, i) => <SkeletonTableRow key={i} cols={5} />)
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-3">{t('when')}</th>
                <th className="p-3">{t('action')}</th>
                <th className="p-3">{t('actor')}</th>
                <th className="p-3">{t('target')}</th>
                <th className="p-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data ?? []).map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="text-muted-foreground p-3 whitespace-nowrap">
                    {format.dateTime(new Date(l.created_at), {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                      timeZone: 'Asia/Manila',
                    })}
                  </td>
                  <td className="p-3 font-mono text-xs font-bold">{l.action}</td>
                  <td className="p-3 text-xs">
                    {l.actor_role ?? 'system'}
                    <span className="text-muted-foreground block font-mono">
                      {l.actor_id?.slice(0, 8)}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {l.target_type}
                    <span className="text-muted-foreground block">{l.target_id?.slice(0, 12)}</span>
                  </td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">{l.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          {t('prev')}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={(data?.length ?? 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('next')}
        </Button>
      </div>
    </div>
  );
}
