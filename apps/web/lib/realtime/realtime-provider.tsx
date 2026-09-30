'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { useAuthTransition } from '@/lib/auth/auth-transition';
import type { NotificationRow } from '@/lib/data/me';

type RealtimeState = { connected: boolean };
const Ctx = createContext<RealtimeState>({ connected: false });
export const useRealtimeStatus = () => useContext(Ctx);

/**
 * One place that maps Realtime events → TanStack Query cache (Section 15.2).
 * Users never press refresh: every server-side change lands here and updates the UI.
 */
export function RealtimeProvider({
  userId,
  groupIds = [],
  children,
}: {
  userId: string | null;
  groupIds?: string[];
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const authTransition = useAuthTransition();
  const [connected, setConnected] = useState(false);
  const wasDisconnected = useRef(false);
  const groupKey = groupIds.join(',');

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const channels: RealtimeChannel[] = [];

    const onStatus = (status: string) => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        if (wasDisconnected.current) {
          // Reconnected after a drop: refetch everything that's on screen once.
          wasDisconnected.current = false;
          void qc.invalidateQueries({ refetchType: 'active' });
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConnected(false);
        wasDisconnected.current = true;
      }
    };

    // System-wide broadcasts (public channel).
    channels.push(
      supabase
        .channel('system')
        .on(
          'broadcast',
          { event: 'content_updated' },
          () => void qc.invalidateQueries({ queryKey: qk.content.all() }),
        )
        .on('broadcast', { event: 'maintenance_on' }, () => router.refresh())
        .on('broadcast', { event: 'maintenance_off' }, () => router.refresh())
        .on(
          'broadcast',
          { event: 'leaderboard_refreshed' },
          () => void qc.invalidateQueries({ queryKey: qk.leaderboard.all() }),
        )
        .on('broadcast', { event: 'app_updated' }, () => {
          if (!window.location.pathname.includes('/play/')) {
            toast.info('May bagong update — i-reload · New update available', {
              action: { label: 'Reload', onClick: () => window.location.reload() },
              duration: Infinity,
            });
          }
        })
        .subscribe(onStatus),
    );

    if (userId) {
      // Private per-user channel (Realtime Authorization: topic user:<id>).
      channels.push(
        supabase
          .channel(`user:${userId}`, { config: { private: true } })
          .on('broadcast', { event: 'role_changed' }, async () => {
            await supabase.auth.refreshSession();
            void qc.invalidateQueries({ queryKey: qk.me.all() });
            router.refresh();
          })
          .on('broadcast', { event: 'session_revoked' }, async () => {
            await supabase.auth.signOut({ scope: 'local' });
            authTransition('/sign-in');
          })
          .on(
            'broadcast',
            { event: 'settings_changed' },
            () => void qc.invalidateQueries({ queryKey: qk.me.settings() }),
          )
          .subscribe(onStatus),
      );

      // Row changes (RLS-filtered) for this user.
      const f = `user_id=eq.${userId}`;
      channels.push(
        supabase
          .channel(`db:${userId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications', filter: f },
            (p) => {
              const row = p.new as NotificationRow;
              qc.setQueryData<NotificationRow[]>(qk.notifications.list(), (old) =>
                [row, ...(old ?? [])].slice(0, 100),
              );
              void qc.invalidateQueries({ queryKey: qk.notifications.unread() });
              toast(row.title, { description: row.body || undefined });
            },
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'notifications', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.notifications.all() }),
          )
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'notifications', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.notifications.all() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'user_settings', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.me.settings() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'player_level_progress', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.me.progress() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'player_achievements', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.me.achievements() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'player_tips', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.me.tips() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'attempts', filter: f },
            () => {
              void qc.invalidateQueries({ queryKey: ['me', 'attempts'] });
            },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'group_members', filter: f },
            () => {
              void qc.invalidateQueries({ queryKey: qk.me.groups() });
              void qc.invalidateQueries({ queryKey: qk.groups.all() });
            },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'facilitator_applications', filter: f },
            () => void qc.invalidateQueries({ queryKey: qk.me.application() }),
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'report_jobs',
              filter: `requested_by=eq.${userId}`,
            },
            () => void qc.invalidateQueries({ queryKey: qk.facilitator.reports() }),
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
            () => void qc.invalidateQueries({ queryKey: qk.me.profile() }),
          )
          .subscribe(onStatus),
      );

      // Content tables: admins publishing changes show up for everyone.
      channels.push(
        supabase
          .channel('db:content')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'tips' },
            () => void qc.invalidateQueries({ queryKey: qk.content.tips() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'hotlines' },
            () => void qc.invalidateQueries({ queryKey: qk.content.hotlines() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'levels' },
            () => void qc.invalidateQueries({ queryKey: qk.content.levels() }),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'announcements' },
            () => void qc.invalidateQueries({ queryKey: ['groups'] }),
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'system_settings' },
            () => {
              void qc.invalidateQueries({ queryKey: qk.system.public() });
              router.refresh();
            },
          )
          .subscribe(onStatus),
      );

      // Group channels: roster, assignments, announcements for groups I'm in or run.
      for (const gid of groupKey ? groupKey.split(',') : []) {
        const gf = `group_id=eq.${gid}`;
        channels.push(
          supabase
            .channel(`db:group:${gid}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'group_members', filter: gf },
              () => {
                void qc.invalidateQueries({ queryKey: qk.groups.members(gid) });
                void qc.invalidateQueries({ queryKey: qk.groups.progress(gid) });
                void qc.invalidateQueries({ queryKey: qk.facilitator.dashboard() });
              },
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'assignments', filter: gf },
              () => void qc.invalidateQueries({ queryKey: qk.groups.assignments(gid) }),
            )
            .on(
              'postgres_changes',
              { event: 'INSERT', schema: 'public', table: 'announcements', filter: gf },
              () => void qc.invalidateQueries({ queryKey: qk.groups.announcements(gid) }),
            )
            .subscribe(onStatus),
        );
        channels.push(
          supabase
            .channel(`group:${gid}`, { config: { private: true } })
            .on('broadcast', { event: 'attempt_completed' }, () => {
              void qc.invalidateQueries({ queryKey: qk.groups.progress(gid) });
              void qc.invalidateQueries({ queryKey: qk.facilitator.dashboard() });
              void qc.invalidateQueries({ queryKey: qk.leaderboard.all() });
            })
            .subscribe(onStatus),
        );
      }
    }

    return () => {
      for (const c of channels) void supabase.removeChannel(c);
    };
  }, [userId, groupKey, qc, router, authTransition]);

  return <Ctx.Provider value={{ connected }}>{children}</Ctx.Provider>;
}
