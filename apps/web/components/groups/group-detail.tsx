'use client';

import { useQuery } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Circle, LogOut, Megaphone, Play, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { SkeletonCard, SkeletonText } from '@/components/skeletons';
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view';
import { useRelativeTime } from '@/lib/i18n/use-relative-time';
import { Button } from '@/components/ui/button';

type Level = { id: number; slug: string; name_fil: string; name_en: string };

export function GroupDetail({
  group,
  levels,
}: {
  group: { id: string; name: string; description: string | null };
  levels: Level[];
}) {
  const t = useTranslations('groupsPage');
  const format = useFormatter();
  const relTime = useRelativeTime();
  const locale = useLocale();
  const router = useRouter();
  const sb = getSupabaseBrowser();
  const lvl = (id: number) => levels.find((l) => l.id === id);

  const assignments = useQuery({
    queryKey: qk.groups.assignments(group.id),
    queryFn: async () => {
      const { data, error } = await sb
        .from('assignments')
        .select('*')
        .eq('group_id', group.id)
        .order('due_at');
      if (error) throw error;
      // Personal completion per assignment.
      const withDone = await Promise.all(
        data.map(async (a) => {
          const { data: prog } = await sb.rpc('assignment_progress', { p_assignment_id: a.id });
          const { data: s } = await sb.auth.getSession();
          const mine = (prog ?? []).find((p) => p.user_id === s.session?.user.id);
          return { ...a, done: !!mine?.done };
        }),
      );
      return withDone;
    },
    staleTime: 15_000,
  });

  const announcements = useQuery({
    queryKey: qk.groups.announcements(group.id),
    queryFn: async () => {
      const { data, error } = await sb
        .from('announcements')
        .select('id, title, body, created_at')
        .eq('group_id', group.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });

  const leave = async () => {
    const { data: s } = await sb.auth.getSession();
    const { error } = await sb
      .from('group_members')
      .delete()
      .eq('group_id', group.id)
      .eq('user_id', s.session?.user.id ?? '');
    if (!error) {
      toast.success(t('leave'));
      router.replace('/groups');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold break-words sm:text-4xl">{group.name}</h1>
          {group.description && <p className="text-muted-foreground">{group.description}</p>}
        </div>
        <Button variant="ghost" className="min-h-11" onClick={leave}>
          <LogOut aria-hidden /> {t('leave')}
        </Button>
      </div>

      <section aria-labelledby="asg" className="space-y-3">
        <h2 id="asg" className="text-2xl font-bold">
          {t('assignments')}
        </h2>
        {assignments.isPending ? (
          <SkeletonCard className="h-28" />
        ) : !assignments.data?.length ? (
          <p className="text-muted-foreground">{t('noAssignments')}</p>
        ) : (
          <ul className="space-y-3">
            {assignments.data.map((a) => {
              const overdue = new Date(a.due_at) < new Date();
              return (
                <li key={a.id} className="bg-card rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-bold">
                        {a.done ? (
                          <CheckCircle2 className="text-evac-green size-5" aria-label={t('done')} />
                        ) : (
                          <Circle className="text-muted-foreground size-5" aria-label={t('todo')} />
                        )}
                        {a.title}
                      </p>
                      <p
                        className={
                          overdue && !a.done
                            ? 'text-signal-red text-sm font-bold'
                            : 'text-muted-foreground text-sm'
                        }
                      >
                        {t('due', {
                          date: format.dateTime(new Date(a.due_at), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: 'Asia/Manila',
                          }),
                        })}
                        {' · '}
                        <Star className="inline size-3.5" aria-hidden />{' '}
                        {t('minStars', { stars: a.min_stars })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.level_ids.map((id) => {
                      const l = lvl(id);
                      return l ? (
                        <Button key={id} asChild size="sm" variant="outline" className="min-h-10">
                          <Link href={`/play/${l.slug}?mode=assignment&assignment=${a.id}`}>
                            <Play className="size-3.5" aria-hidden />{' '}
                            {locale === 'en' ? l.name_en : l.name_fil}
                          </Link>
                        </Button>
                      ) : null;
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="ann" className="space-y-3">
        <h2 id="ann" className="text-2xl font-bold">
          {t('announcements')}
        </h2>
        <div className="bg-card rounded-lg border">
          {announcements.isPending ? (
            <div className="p-4">
              <SkeletonText lines={3} />
            </div>
          ) : !announcements.data?.length ? (
            <p className="text-muted-foreground p-4">{t('noAnnouncements')}</p>
          ) : (
            <ul className="divide-y">
              {announcements.data.map((n) => (
                <li key={n.id} className="p-4">
                  <p className="flex items-center gap-2 font-bold">
                    <Megaphone className="text-lake size-4" aria-hidden /> {n.title}
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-line">{n.body}</p>
                  <time className="text-muted-foreground text-xs" dateTime={n.created_at}>
                    {relTime(n.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="lb" className="space-y-3">
        <h2 id="lb" className="text-2xl font-bold">
          {t('leaderboard')}
        </h2>
        <LeaderboardView
          levels={levels.filter((l) => l.id > 0)}
          groups={[{ id: group.id, name: group.name }]}
          hasBarangay
          initialScope="group"
        />
      </section>
    </div>
  );
}
