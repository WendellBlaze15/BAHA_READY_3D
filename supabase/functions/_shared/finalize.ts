import type { SupabaseClient } from '@supabase/supabase-js';
import type { LevelConfig } from './shared/level-config.ts';
import {
  computeResult,
  generateLayout,
  type ClientSummary,
  type GameContent,
  type GameEvent,
} from './shared/game/index.ts';

/** Runs authoritative scoring and persists everything in one DB transaction (finalize_attempt). */
export async function scoreAndFinalize(opts: {
  admin: SupabaseClient;
  attemptId: string;
  config: LevelConfig;
  content: GameContent;
  seed: string | number;
  events: GameEvent[];
  clientSummary?: ClientSummary;
}) {
  const layout = generateLayout(opts.config, opts.seed);
  const result = computeResult(opts.config, opts.content, layout, opts.events);

  // The client runs the same pure function; claiming a higher score than the replay is tampering.
  if (opts.clientSummary && opts.clientSummary.score > result.score + 50) {
    result.flags = [...result.flags, 'SUMMARY_MISMATCH'].sort() as typeof result.flags;
  }

  const essentials = opts.config.items.filter(
    (k) => opts.content.items.find((i) => i.key === k)?.is_essential,
  );
  const nonEssentialPacked = result.packed.some(
    (k) => opts.content.items.find((i) => i.key === k)?.category === 'non_essential',
  );
  const perfectGobag =
    essentials.length > 0 &&
    essentials.every((k) => result.packed.includes(k)) &&
    !nonEssentialPacked;

  const { data, error } = await opts.admin.rpc('finalize_attempt', {
    p_attempt_id: opts.attemptId,
    p_result: { ...result, perfectGobag },
  });
  if (error) throw new Error(`finalize_attempt: ${error.message}`);
  return {
    result,
    extras: data as {
      new_tips: unknown[];
      new_achievements: unknown[];
      unlocked_level: number | null;
      flagged: boolean;
    },
  };
}
