'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Ban, KeyRound, Loader2, LogOut, Search, ShieldCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { ReauthDialog } from '@/components/auth/reauth-dialog';
import { SkeletonTableRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type UserRow = {
  id: string;
  username: string;
  email: string;
  status: string;
  roles: string[];
  created_at: string;
  suspended_until: string | null;
  suspension_reason: string | null;
  attempts: number;
  mfa: boolean;
  total: number;
};

const PAGE = 20;

export function UsersAdmin({ extraAction }: { extraAction?: (u: UserRow) => React.ReactNode }) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const errText = useApiErrorText();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [suspending, setSuspending] = useState<UserRow | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(7);
  const [reauthFor, setReauthFor] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const key = { query, status, page };
  const { data, isPending, isFetching } = useQuery({
    queryKey: qk.admin.users(key),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().rpc('admin_search_users', {
        p_query: query,
        p_status: status === 'all' ? undefined : status,
        p_offset: page * PAGE,
        p_limit: PAGE,
      });
      if (error) throw error;
      return data as unknown as UserRow[];
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const total = data?.[0]?.total ?? 0;

  const act = async (u: UserRow, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await apiPost(`/api/admin/users/${u.id}`, body);
      toast.success(t('done'));
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      return true;
    } catch (e) {
      toast.error(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-4xl font-bold">{t('usersTitle')}</h1>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(q.trim());
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-11 pl-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="h-11 w-40" aria-label={t('status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['all', 'active', 'suspended', 'deleted'].map((s) => (
              <SelectItem key={s} value={s}>
                {t(s as 'all')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" className="min-h-11">
          {isFetching ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
        </Button>
      </form>

      <div className="bg-card overflow-x-auto rounded-lg border">
        {isPending ? (
          Array.from({ length: 8 }, (_, i) => <SkeletonTableRow key={i} cols={6} />)
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-3">Username</th>
                <th className="p-3">Email</th>
                <th className="p-3">{t('roles')}</th>
                <th className="p-3">{t('status')}</th>
                <th className="p-3">{t('mfa')}</th>
                <th className="p-3">{t('joined')}</th>
                <th className="p-3">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="p-3 font-bold">{u.username}</td>
                  <td className="text-muted-foreground max-w-56 truncate p-3">{u.email}</td>
                  <td className="p-3">{u.roles.join(', ')}</td>
                  <td className="p-3">
                    <span
                      className={
                        u.status === 'active'
                          ? 'text-evac-green font-bold'
                          : 'text-signal-red font-bold'
                      }
                    >
                      {t(u.status as 'active')}
                    </span>
                    {u.suspension_reason && (
                      <span className="text-muted-foreground block text-xs">
                        {u.suspension_reason}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {u.mfa ? (
                      <ShieldCheck className="text-evac-green size-4" aria-label="MFA on" />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-muted-foreground p-3 whitespace-nowrap">
                    {format.dateTime(new Date(u.created_at), { dateStyle: 'medium' })}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {u.status === 'suspended' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={busy}
                        onClick={() => void act(u, { action: 'unsuspend' })}
                      >
                        <Undo2 aria-hidden /> {t('unsuspend')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={busy || u.roles.includes('super_admin')}
                        onClick={() => {
                          setSuspending(u);
                          setReason('');
                        }}
                      >
                        <Ban aria-hidden /> {t('suspend')}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-10"
                      title={t('signout')}
                      aria-label={t('signout')}
                      disabled={busy}
                      onClick={() => void act(u, { action: 'signout' })}
                    >
                      <LogOut aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-10"
                      title={t('resetMfa')}
                      aria-label={t('resetMfa')}
                      disabled={busy || !u.mfa}
                      onClick={() => setReauthFor(u)}
                    >
                      <KeyRound aria-hidden />
                    </Button>
                    {extraAction?.(u)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{total} users</p>
        <div className="flex gap-2">
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
            disabled={(page + 1) * PAGE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('next')}
          </Button>
        </div>
      </div>

      <Dialog open={!!suspending} onOpenChange={(o) => !o && setSuspending(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('suspend')}: {suspending?.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-reason">{t('reason')}</Label>
              <Textarea
                id="s-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-days">{t('days')}</Label>
              <Input
                id="s-days"
                type="number"
                min={0}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 0)}
                className="h-11 w-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                if (
                  suspending &&
                  (await act(suspending, { action: 'suspend', reason: reason.trim(), days }))
                )
                  setSuspending(null);
              }}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReauthDialog
        open={!!reauthFor}
        onOpenChange={(o) => !o && setReauthFor(null)}
        hasTotp
        emailDeliverable
        onConfirmed={async () => {
          if (reauthFor) await act(reauthFor, { action: 'reset_mfa' });
          setReauthFor(null);
        }}
      />
    </div>
  );
}
