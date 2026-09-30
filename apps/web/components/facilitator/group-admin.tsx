'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import {
  Archive,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Send,
  UserMinus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useRoster, useSetMemberStatus, type RosterRow } from '@/lib/data/facilitator';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { SkeletonTableRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useRelativeTime } from '@/lib/i18n/use-relative-time';
import { Textarea } from '@/components/ui/textarea';

type Group = {
  id: string;
  name: string;
  description: string | null;
  join_code: string;
  requires_approval: boolean;
  max_members: number;
  is_archived: boolean;
};

export function GroupAdmin({ initial, appUrl }: { initial: Group; appUrl: string }) {
  const t = useTranslations('fac');
  const qc = useQueryClient();
  const sb = getSupabaseBrowser();
  const [group, setGroup] = useState(initial);
  const [qr, setQr] = useState('');
  const joinUrl = `${appUrl}/groups?code=${group.join_code}`;

  useEffect(() => {
    void QRCode.toDataURL(joinUrl, {
      width: 480,
      margin: 1,
      color: { dark: '#1E2A38', light: '#FFFFFF' },
    }).then(setQr);
  }, [joinUrl]);

  const update = async (patch: Partial<Group>) => {
    const prev = group;
    setGroup({ ...group, ...patch });
    const { error } = await sb.from('groups').update(patch).eq('id', group.id);
    if (error) {
      setGroup(prev);
      toast.error(error.message);
    } else void qc.invalidateQueries({ queryKey: qk.groups.mine() });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold break-words sm:text-4xl">{group.name}</h1>
          {group.description && <p className="text-muted-foreground">{group.description}</p>}
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() =>
            update({ is_archived: !group.is_archived }).then(() => toast.success(t('archived')))
          }
        >
          <Archive aria-hidden /> {t('archive')}
        </Button>
      </div>

      <section className="bg-card grid gap-5 rounded-2xl border p-5 md:grid-cols-[auto_1fr]">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR ${group.join_code}`}
            width={200}
            height={200}
            className="rounded-lg border bg-white p-2"
          />
        ) : (
          <div className="skeleton size-[200px]" />
        )}
        <div className="space-y-4">
          <div>
            <p className="text-muted-foreground text-sm font-bold">{t('code')}</p>
            <p className="font-display text-6xl font-bold tracking-[0.25em]" aria-live="polite">
              {group.join_code}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={async () => {
                await navigator.clipboard.writeText(group.join_code);
                toast.success(t('copied'));
              }}
            >
              <Copy aria-hidden /> {t('copyCode')}
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <a href={qr} download={`baha-ready-${group.join_code}.png`}>
                <Download aria-hidden /> {t('downloadQr')}
              </a>
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={async () => {
                const { data, error } = await sb.rpc('regenerate_join_code', { gid: group.id });
                if (error) toast.error(error.message);
                else {
                  setGroup({ ...group, join_code: data as string });
                  toast.success(t('regenerated'));
                }
              }}
            >
              <RefreshCw aria-hidden /> {t('regenerate')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex min-h-11 items-center gap-3">
              <Switch
                id="appr"
                checked={group.requires_approval}
                onCheckedChange={(v) => void update({ requires_approval: v })}
              />
              <Label htmlFor="appr" className="font-normal">
                {t('requiresApproval')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="max">{t('maxMembers')}</Label>
              <Input
                id="max"
                type="number"
                min={1}
                max={500}
                defaultValue={group.max_members}
                className="h-11 w-24"
                onBlur={(e) =>
                  void update({
                    max_members: Math.max(1, Math.min(500, Number(e.target.value) || 1)),
                  })
                }
              />
            </div>
          </div>
        </div>
      </section>

      <Roster groupId={group.id} />
      <AnnouncementForm groupId={group.id} />
    </div>
  );
}

function Roster({ groupId }: { groupId: string }) {
  const t = useTranslations('fac');
  const relTime = useRelativeTime();
  const { data, isPending } = useRoster(groupId);
  const set = useSetMemberStatus(groupId);
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => (data ?? []).filter((r) => r.username.toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  const pending = rows.filter((r) => r.status === 'pending');
  const active = rows.filter((r) => r.status === 'active');

  /** Optimistic action with a 5s undo toast (Section 8.3 F2). */
  const act = (
    r: RosterRow,
    status: 'active' | 'removed',
    msgKey: 'approved' | 'rejectedMember' | 'removed',
  ) => {
    const before = r.status as 'active' | 'pending';
    set.mutate({ userId: r.user_id, status });
    toast(t(msgKey, { name: r.username }), {
      duration: 5000,
      action: {
        label: t('undo'),
        onClick: () => set.mutate({ userId: r.user_id, status: before }),
      },
    });
  };

  return (
    <section className="space-y-3">
      {pending.length > 0 && (
        <div className="border-signal-amber bg-signal-amber/10 space-y-2 rounded-lg border-2 p-4">
          <h2 className="text-lg font-bold">
            {t('requests')} ({pending.length})
          </h2>
          <ul className="divide-y">
            {pending.map((r) => (
              // Wraps on narrow phones: name on its own line, buttons below (never outside the box).
              <li key={r.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                  <span className="shrink-0">
                    <BlockyAvatar config={r.avatar_config as Partial<AvatarConfig>} size={24} />
                  </span>
                  <span className="truncate font-bold" title={r.username}>
                    {r.username}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    className="bg-evac-green min-h-10 text-white"
                    onClick={() => act(r, 'active', 'approved')}
                  >
                    <Check aria-hidden /> {t('approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    onClick={() => act(r, 'removed', 'rejectedMember')}
                  >
                    <X aria-hidden /> {t('reject')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">
          {t('members')} ({active.length})
        </h2>
        <div className="relative">
          <Search
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-11 w-60 pl-9"
          />
        </div>
      </div>
      <div className="bg-card overflow-hidden rounded-lg border">
        {isPending ? (
          Array.from({ length: 5 }, (_, i) => <SkeletonTableRow key={i} cols={4} />)
        ) : (
          <>
            {/* Table on tablet+, stacked cards on phones (Section 17.1). */}
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-3">{t('members')}</th>
                  <th className="p-3">{t('levelsDone')}</th>
                  <th className="p-3">{t('stars')}</th>
                  <th className="p-3">{t('lastPlayed')}</th>
                  <th className="p-3">
                    <span className="sr-only">{t('remove')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {active.map((r) => (
                  <tr key={r.user_id}>
                    <td className="p-3">
                      <span className="flex items-center gap-2 font-bold">
                        <BlockyAvatar config={r.avatar_config as Partial<AvatarConfig>} size={20} />{' '}
                        {r.username}
                      </span>
                    </td>
                    <td className="p-3 tabular-nums">{r.levels_done}/5</td>
                    <td className="p-3 tabular-nums">{r.stars}★</td>
                    <td className="text-muted-foreground p-3">
                      {r.last_played ? relTime(r.last_played) : t('never')}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-10"
                        onClick={() => {
                          if (confirm(t('removeConfirm', { name: r.username })))
                            act(r, 'removed', 'removed');
                        }}
                      >
                        <UserMinus aria-hidden /> {t('remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y md:hidden">
              {active.map((r) => (
                <li key={r.user_id} className="flex items-center gap-3 p-3">
                  <BlockyAvatar config={r.avatar_config as Partial<AvatarConfig>} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{r.username}</p>
                    <p className="text-muted-foreground text-xs">
                      {r.levels_done}/5 · {r.stars}★ ·{' '}
                      {r.last_played ? relTime(r.last_played) : t('never')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={t('remove')}
                    onClick={() => {
                      if (confirm(t('removeConfirm', { name: r.username })))
                        act(r, 'removed', 'removed');
                    }}
                  >
                    <UserMinus aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {!active.length && <p className="text-muted-foreground p-4 text-sm">{t('noData')}</p>}
          </>
        )}
      </div>
    </section>
  );
}

function AnnouncementForm({ groupId }: { groupId: string }) {
  const t = useTranslations('fac');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="bg-card space-y-3 rounded-lg border p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const { data: s } = await getSupabaseBrowser().auth.getSession();
        const { error } = await getSupabaseBrowser().from('announcements').insert({
          scope: 'group',
          group_id: groupId,
          title: title.trim(),
          body: body.trim(),
          created_by: s.session?.user.id,
        });
        setBusy(false);
        if (error) toast.error(error.message);
        else {
          toast.success(t('posted'));
          setTitle('');
          setBody('');
        }
      }}
    >
      <h2 className="text-xl font-bold">{t('announcementsTitle')}</h2>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        placeholder={t('announcementTitle')}
        aria-label={t('announcementTitle')}
        className="h-11"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        rows={3}
        placeholder={t('announcementBody')}
        aria-label={t('announcementBody')}
      />
      <Button
        type="submit"
        disabled={busy || title.trim().length < 2 || !body.trim()}
        className="min-h-11"
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} {t('post')}
      </Button>
    </form>
  );
}
