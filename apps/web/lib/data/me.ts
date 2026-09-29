'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import type { Database } from '@/lib/supabase/database.types';

type Tables = Database['public']['Tables'];
export type ProfileRow = Tables['profiles']['Row'];
export type SettingsRow = Tables['user_settings']['Row'];
export type NotificationRow = Tables['notifications']['Row'];
export type ProgressRow = Tables['player_level_progress']['Row'];

const sb = () => getSupabaseBrowser();

async function uid() {
  const { data } = await sb().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  return id;
}

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data as T;
}

export function useProfile(initial?: ProfileRow | null) {
  return useQuery({
    queryKey: qk.me.profile(),
    queryFn: async () =>
      must(
        await sb()
          .from('profiles')
          .select('*')
          .eq('id', await uid())
          .single(),
      ),
    staleTime: 5 * 60_000,
    initialData: initial ?? undefined,
  });
}

export function useSettings(initial?: SettingsRow | null) {
  return useQuery({
    queryKey: qk.me.settings(),
    queryFn: async () =>
      must(
        await sb()
          .from('user_settings')
          .select('*')
          .eq('user_id', await uid())
          .single(),
      ),
    staleTime: 5 * 60_000,
    initialData: initial ?? undefined,
  });
}

type SettingsPatch = Partial<Omit<SettingsRow, 'user_id' | 'updated_at'>>;

/** Optimistic settings update with rollback (last-write-wins across devices). */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) =>
      must(
        await sb()
          .from('user_settings')
          .update(patch)
          .eq('user_id', await uid())
          .select()
          .single(),
      ),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.me.settings() });
      const prev = qc.getQueryData<SettingsRow>(qk.me.settings());
      if (prev) qc.setQueryData<SettingsRow>(qk.me.settings(), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.me.settings(), ctx.prev);
    },
    onSuccess: (row) => qc.setQueryData(qk.me.settings(), row),
  });
}

type ProfilePatch = Partial<
  Pick<
    ProfileRow,
    | 'display_name'
    | 'avatar_key'
    | 'avatar_config'
    | 'barangay'
    | 'school'
    | 'language'
    | 'leaderboard_visible'
    | 'username'
  >
>;

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) =>
      must(
        await sb()
          .from('profiles')
          .update(patch)
          .eq('id', await uid())
          .select()
          .single(),
      ),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.me.profile() });
      const prev = qc.getQueryData<ProfileRow>(qk.me.profile());
      if (prev) qc.setQueryData<ProfileRow>(qk.me.profile(), { ...prev, ...patch } as ProfileRow);
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.me.profile(), ctx.prev);
    },
    onSuccess: (row) => qc.setQueryData(qk.me.profile(), row),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications.list(),
    queryFn: async () =>
      must(
        await sb()
          .from('notifications')
          .select('*')
          .eq('user_id', await uid())
          .order('created_at', { ascending: false })
          .limit(100),
      ),
    staleTime: 0,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: qk.notifications.unread(),
    queryFn: async () => {
      const { count, error } = await sb()
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', await uid())
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 0,
  });
}

/** Mark read (one or all) — optimistic; read state syncs to all devices via Realtime. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | 'all') => {
      const now = new Date().toISOString();
      let q = sb()
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', await uid())
        .is('read_at', null);
      if (ids !== 'all') q = q.in('id', ids);
      must(await q);
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: qk.notifications.all() });
      const prevList = qc.getQueryData<NotificationRow[]>(qk.notifications.list());
      const prevCount = qc.getQueryData<number>(qk.notifications.unread());
      const now = new Date().toISOString();
      qc.setQueryData<NotificationRow[]>(qk.notifications.list(), (old) =>
        old?.map((n) =>
          ids === 'all' || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n,
        ),
      );
      qc.setQueryData<number>(qk.notifications.unread(), (c) =>
        ids === 'all' ? 0 : Math.max(0, (c ?? 0) - ids.length),
      );
      return { prevList, prevCount };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(qk.notifications.list(), ctx?.prevList);
      qc.setQueryData(qk.notifications.unread(), ctx?.prevCount);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notifications.unread() }),
  });
}

export function useProgress() {
  return useQuery({
    queryKey: qk.me.progress(),
    queryFn: async () =>
      must(
        await sb()
          .from('player_level_progress')
          .select('*')
          .eq('user_id', await uid())
          .order('level_id'),
      ),
    staleTime: 30_000,
  });
}

export function useStreak() {
  return useQuery({
    queryKey: qk.me.streak(),
    queryFn: async () => {
      const { data, error } = await sb()
        .from('streaks')
        .select('*')
        .eq('user_id', await uid())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useMyAttempts(limit = 20) {
  return useQuery({
    queryKey: qk.me.attempts(limit),
    queryFn: async () =>
      must(
        await sb()
          .from('attempts')
          .select(
            'id, level_id, mode, status, score, stars, duration_ms, hazard_hits, npcs_rescued, started_at, finished_at, flag_reasons',
          )
          .eq('user_id', await uid())
          .neq('status', 'in_progress')
          .order('started_at', { ascending: false })
          .limit(limit),
      ),
    staleTime: 30_000,
  });
}

export function useMyAchievements() {
  return useQuery({
    queryKey: qk.me.achievements(),
    queryFn: async () =>
      must(
        await sb()
          .from('player_achievements')
          .select('achievement_id, unlocked_at')
          .eq('user_id', await uid()),
      ),
    staleTime: 30_000,
  });
}

export function useMyTips() {
  return useQuery({
    queryKey: qk.me.tips(),
    queryFn: async () =>
      must(
        await sb()
          .from('player_tips')
          .select('tip_id, unlocked_at, read_at')
          .eq('user_id', await uid()),
      ),
    staleTime: 30_000,
  });
}
