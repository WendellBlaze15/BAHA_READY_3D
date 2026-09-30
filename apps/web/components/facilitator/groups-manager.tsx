'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Archive, Loader2, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useMyOwnedGroups } from '@/lib/data/facilitator';
import { SkeletonCard } from '@/components/skeletons';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export function GroupsManager() {
  const t = useTranslations('fac');
  const qc = useQueryClient();
  const params = useSearchParams();
  const { data, isPending } = useMyOwnedGroups();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    max_members: 60,
    requires_approval: false,
  });
  useEffect(() => {
    if (params.get('new') === '1') setOpen(true);
  }, [params]);

  async function create() {
    setBusy(true);
    const tempId = `temp-${Date.now()}`;
    // Optimistic insert; the server generates the real join code.
    qc.setQueryData(qk.groups.mine(), (old: unknown[] | undefined) => [
      {
        id: tempId,
        ...form,
        join_code: '······',
        is_archived: false,
        created_at: new Date().toISOString(),
      },
      ...(old ?? []),
    ]);
    setOpen(false);
    const { error } = await getSupabaseBrowser()
      .from('groups')
      .insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        max_members: form.max_members,
        requires_approval: form.requires_approval,
        join_code: 'AAAAAA',
      });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t('created'));
      setForm({ name: '', description: '', max_members: 60, requires_approval: false });
    }
    void qc.invalidateQueries({ queryKey: qk.groups.mine() });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-bold">{t('groupsTitle')}</h1>
        <Button
          onClick={() => setOpen(true)}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-11 font-bold"
        >
          <Plus aria-hidden /> {t('newGroup')}
        </Button>
      </div>
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} className="h-28" />
          ))}
        </div>
      ) : !data?.length ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-6">{t('noData')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.map((g) => (
            <li key={g.id}>
              <Link
                href={g.id.startsWith('temp-') ? '#' : `/facilitator/groups/${g.id}`}
                className="bg-card hover:border-primary flex h-full flex-col gap-2 rounded-lg border p-4"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-lg font-bold">
                    <Users className="text-lake size-5" aria-hidden /> {g.name}
                  </span>
                  {g.is_archived && (
                    <Archive className="text-muted-foreground size-4" aria-label={t('archived')} />
                  )}
                </span>
                <span className="text-muted-foreground line-clamp-2 text-sm">{g.description}</span>
                <span className="font-display bg-muted self-start rounded-sm px-2 py-0.5 text-xl tracking-[0.25em]">
                  {g.join_code}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('newGroup')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">{t('groupName')}</Label>
              <Input
                id="g-name"
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-desc">{t('description')}</Label>
              <Textarea
                id="g-desc"
                value={form.description}
                maxLength={500}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-max">{t('maxMembers')}</Label>
              <Input
                id="g-max"
                type="number"
                min={1}
                max={500}
                value={form.max_members}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_members: Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                  })
                }
                className="h-11 w-32"
              />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="g-appr" className="font-normal">
                {t('requiresApproval')}
              </Label>
              <Switch
                id="g-appr"
                checked={form.requires_approval}
                onCheckedChange={(v) => setForm({ ...form, requires_approval: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy || form.name.trim().length < 2}
              onClick={() => void create()}
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-11 font-bold"
            >
              {busy && <Loader2 className="animate-spin" aria-hidden />} {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
