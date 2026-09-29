'use client';

import { useQuery } from '@tanstack/react-query';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import type { Database } from '@/lib/supabase/database.types';

type Tables = Database['public']['Tables'];
export type TipRow = Tables['tips']['Row'];
export type HotlineRow = Tables['hotlines']['Row'];
export type LevelRow = Tables['levels']['Row'];
export type AchievementRow = Tables['achievements']['Row'];

const HOUR = 60 * 60_000;
const sb = () => getSupabaseBrowser();

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Content changes rarely: 1h staleTime, invalidated live by content_updated broadcasts. */
export function useTips(initial?: TipRow[]) {
  return useQuery({
    queryKey: qk.content.tips(),
    queryFn: async () => must(await sb().from('tips').select('*').order('sort_order')),
    staleTime: HOUR,
    initialData: initial,
  });
}

export function useHotlines(initial?: HotlineRow[]) {
  return useQuery({
    queryKey: qk.content.hotlines(),
    queryFn: async () => must(await sb().from('hotlines').select('*').order('sort_order')),
    staleTime: HOUR,
    initialData: initial,
  });
}

export function useLevels() {
  return useQuery({
    queryKey: qk.content.levels(),
    queryFn: async () => must(await sb().from('levels').select('*').order('sort_order')),
    staleTime: HOUR,
  });
}

export function useAchievementDefs() {
  return useQuery({
    queryKey: qk.content.achievements(),
    queryFn: async () => must(await sb().from('achievements').select('*').order('sort_order')),
    staleTime: HOUR,
  });
}

export function useDailyChallenge() {
  return useQuery({
    queryKey: qk.daily.today(),
    queryFn: async () => {
      const { data, error } = await sb()
        .from('daily_challenges')
        .select('*')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
