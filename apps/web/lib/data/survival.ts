'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SURVIVAL_CONFIG,
  survivalConfigSchema,
  type SurvivalConfig,
} from '@baha/shared/survival';
import { qk } from '@/lib/query-keys';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { api } from '@/lib/survival/client';

const sb = () => getSupabaseBrowser();

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
  return res.data as T;
}

export type SurvivalRunRow = {
  run_id: string;
  mode: 'solo' | 'coop';
  difficulty: 'easy' | 'normal' | 'hard';
  status: string;
  current_day: number;
  boat_stage: number;
  ending: string | null;
  final_score: number | null;
  is_host: boolean;
  last_session_at: string | null;
  created_at: string;
  teammates: {
    user_id: string;
    username: string;
    avatar_config: unknown;
    role: string;
    status: string;
  }[];
};

export function useMyRuns() {
  return useQuery({
    queryKey: qk.survival.runs(),
    queryFn: async () =>
      must(await sb().rpc('list_my_survival_runs')) as unknown as SurvivalRunRow[],
    staleTime: 15_000,
  });
}

/** Public kill switch + limits (system_settings is_public rows). */
export function useSurvivalSettings() {
  return useQuery({
    queryKey: [...qk.system.public(), 'survival'],
    queryFn: async () => {
      const rows = must(
        await sb()
          .from('system_settings')
          .select('key, value')
          .in('key', ['survival_enabled', 'survival_max_active_runs_per_player']),
      ) as { key: string; value: unknown }[];
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      return {
        enabled: get('survival_enabled') !== false && get('survival_enabled') !== 'false',
        maxActiveRuns: Number(get('survival_max_active_runs_per_player') ?? 3),
      };
    },
    staleTime: 60_000,
  });
}

/**
 * A run's config version (item names, recipes, boat stages). Falls back to the built-in
 * defaults while loading so screens never block on it.
 */
export function useSurvivalConfig(version: number | null | undefined) {
  const q = useQuery({
    queryKey: qk.survival.config(version ?? null),
    enabled: !!version,
    queryFn: async () => {
      const row = must(
        await sb()
          .from('survival_config_versions')
          .select('config')
          .eq('version', version!)
          .single(),
      ) as { config: unknown };
      return survivalConfigSchema.parse(row.config);
    },
    staleTime: Infinity,
  });
  return (q.data ?? DEFAULT_SURVIVAL_CONFIG) as SurvivalConfig;
}

export type SurvivalResult = {
  run_id: string;
  ending: 'full_rescue' | 'partial_rescue' | 'failed';
  days_survived: number;
  final_score: number;
  difficulty: 'easy' | 'normal' | 'hard';
  team_size: number;
  real_minutes_played: number;
  learning_summary: Record<string, { good: number; bad: number }>;
  per_player: Record<string, { rescued?: boolean; deaths?: number; revives_given?: number }>;
  created_at: string;
};

export function useRunResult(runId: string) {
  return useQuery({
    queryKey: qk.survival.result(runId),
    queryFn: async () =>
      must(
        await sb().from('survival_results').select('*').eq('run_id', runId).maybeSingle(),
      ) as unknown as SurvivalResult | null,
  });
}

export type BoardRow = {
  rank: number;
  run_id: string;
  final_score: number;
  ending: string;
  team_size: number;
  real_minutes_played: number;
  ended_at: string;
  members: { username: string; avatar_config: unknown }[];
};

export function useSurvivalBoard(
  difficulty: string,
  team: 'solo' | 'team',
  period: 'weekly' | 'all_time',
) {
  return useQuery({
    queryKey: qk.survival.board(difficulty, team, period),
    queryFn: async () =>
      must(
        await sb().rpc('get_survival_leaderboard', {
          p_difficulty: difficulty,
          p_team_type: team,
          p_period: period,
          p_cursor: 0,
          p_limit: 50,
        }),
      ) as unknown as BoardRow[],
    staleTime: 30_000,
  });
}

export function useResumeRun() {
  return useMutation({
    mutationFn: (runId: string) =>
      api<{ roomId: string; created: boolean }>(`/api/survival/runs/${runId}/resume`, {
        method: 'POST',
        body: '{}',
      }),
  });
}

export function useLeaveRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api<{ ok: true }>(`/api/survival/runs/${runId}/leave`, { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.survival.runs() }),
  });
}

export function useResolveCode() {
  return useMutation({
    mutationFn: (code: string) =>
      api<{ roomId: string }>(`/api/survival/join/${encodeURIComponent(code)}`),
  });
}
