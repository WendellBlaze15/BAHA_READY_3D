'use client';

import { useTranslations } from 'next-intl';
import { BellOff, CheckCheck } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useMarkNotificationsRead, useNotifications } from '@/lib/data/me';
import { Skeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { useRelativeTime } from '@/lib/i18n/use-relative-time';
import { cn } from '@/lib/utils';

export function NotificationsCenter() {
  const t = useTranslations('notificationsPage');
  const relTime = useRelativeTime();
  const router = useRouter();
  const { data, isPending } = useNotifications();
  const mark = useMarkNotificationsRead();
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={!unread || mark.isPending}
          onClick={() => mark.mutate('all')}
        >
          <CheckCheck aria-hidden /> {t('markAll')}
        </Button>
      </div>

      {isPending ? (
        <ul className="bg-card divide-y rounded-lg border" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="space-y-2 p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3.5 w-3/4" />
            </li>
          ))}
        </ul>
      ) : !data?.length ? (
        <div className="bg-card flex flex-col items-center gap-3 rounded-lg border p-10 text-center">
          <BellOff className="text-muted-foreground size-8" aria-hidden />
          <p className="text-muted-foreground max-w-sm">{t('empty')}</p>
        </div>
      ) : (
        <ul className="bg-card divide-y rounded-lg border">
          {data.map((n) => {
            const href = (n.data as { href?: string } | null)?.href;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'hover:bg-muted flex w-full items-start gap-3 p-4 text-left',
                    !n.read_at && 'bg-accent/40',
                  )}
                  onClick={() => {
                    if (!n.read_at) mark.mutate([n.id]);
                    if (href?.startsWith('/')) router.push(href);
                  }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-2 size-2.5 shrink-0 rounded-full',
                      n.read_at ? 'bg-transparent' : 'bg-signal-red',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{n.title}</span>
                      {!n.read_at && <span className="sr-only">({t('unread')})</span>}
                    </span>
                    {n.body && (
                      <span className="text-muted-foreground block text-sm">{n.body}</span>
                    )}
                    <time
                      dateTime={n.created_at}
                      className="text-muted-foreground mt-1 block text-xs"
                    >
                      {relTime(n.created_at)}
                    </time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
