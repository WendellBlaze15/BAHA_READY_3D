'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';

const sb = () => getSupabaseBrowser();
const must = <T>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export type Overview = {
  groups: number;
  members: number;
  active_today: number;
  avg_stars: number | null;
  attempts: number;
  completion_rate: number | null;
  top_mistakes: { key: string; count: number }[];
  pending_requests: number;
};

export function useOverview(groupId?: string) {
  return useQuery({
    queryKey: [...qk.facilitator.dashboard(), groupId ?? 'all'],
    queryFn: async () =>
      must(
        await sb().rpc('facilitator_overview', groupId ? { p_group_id: groupId } : {}),
      ) as unknown as Overview,
    staleTime: 15_000,
  });
}

export function useMyOwnedGroups() {
  return useQuery({
    queryKey: qk.groups.mine(),
    queryFn: async () => {
      const { data: s } = await sb().auth.getSession();
      return must(
        await sb()
          .from('groups')
          .select(
            'id, name, description, join_code, requires_approval, max_members, is_archived, created_at',
          )
          .eq('facilitator_id', s.session?.user.id ?? '')
          .order('created_at', { ascending: false }),
      );
    },
    staleTime: 15_000,
  });
}

export type RosterRow = {
  user_id: string;
  username: string;
  avatar_config: unknown;
  status: string;
  joined_at: string;
  levels_done: number;
  stars: number;
  last_played: string | null;
};

export function useRoster(groupId: string) {
  return useQuery({
    queryKey: qk.groups.members(groupId),
    queryFn: async () =>
      must(await sb().rpc('get_group_roster', { p_group_id: groupId })) as RosterRow[],
    staleTime: 15_000,
  });
}

/** Approve / reject / remove with optimistic roster update (undo handled by the caller). */
export function useSetMemberStatus(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      status,
    }: {
      userId: string;
      status: 'active' | 'removed' | 'pending';
    }) =>
      must(
        await sb()
          .from('group_members')
          .update({ status })
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .select(),
      ),
    onMutate: async ({ userId, status }) => {
      await qc.cancelQueries({ queryKey: qk.groups.members(groupId) });
      const prev = qc.getQueryData<RosterRow[]>(qk.groups.members(groupId));
      qc.setQueryData<RosterRow[]>(qk.groups.members(groupId), (rows) =>
        status === 'removed'
          ? rows?.filter((r) => r.user_id !== userId)
          : rows?.map((r) => (r.user_id === userId ? { ...r, status } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.groups.members(groupId), ctx?.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.groups.members(groupId) });
      void qc.invalidateQueries({ queryKey: qk.facilitator.dashboard() });
    },
  });
}
