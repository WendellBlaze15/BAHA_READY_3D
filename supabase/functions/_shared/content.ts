import type { SupabaseClient } from '@supabase/supabase-js';
import { levelConfigSchema, type LevelConfig } from './shared/level-config.ts';
import { applyDailyModifiers, type GameContent } from './shared/game/index.ts';
import { HttpError } from './http.ts';

/** Published game content used by authoritative scoring (cached per isolate for 5 min). */
let cache: { at: number; content: GameContent } | null = null;

export async function loadContent(admin: SupabaseClient): Promise<GameContent> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.content;
  const [items, tasks, hazards, npcs] = await Promise.all([
    admin
      .from('gobag_items')
      .select('key, weight_kg, category, is_essential, points')
      .eq('is_published', true),
    admin.from('home_tasks').select('key, points').eq('is_published', true),
    admin.from('hazards').select('key, penalty, instant_fail').eq('is_published', true),
    admin.from('npc_types').select('key, points, needs').eq('is_published', true),
  ]);
  const content: GameContent = {
    items: (items.data ?? []).map((i) => ({ ...i, weight_kg: Number(i.weight_kg) })),
    tasks: tasks.data ?? [],
    hazards: hazards.data ?? [],
    npcs: (npcs.data ?? []) as GameContent['npcs'],
  };
  cache = { at: Date.now(), content };
  return content;
}

export async function loadLevelConfig(
  admin: SupabaseClient,
  levelVersionId: string,
  dailyDate?: string | null,
): Promise<LevelConfig> {
  const { data } = await admin
    .from('level_versions')
    .select('config')
    .eq('id', levelVersionId)
    .single();
  const parsed = levelConfigSchema.safeParse(data?.config);
  if (!parsed.success) throw new HttpError('INTERNAL', 'errors.internal');
  let cfg = parsed.data;
  if (dailyDate) {
    const { data: d } = await admin
      .from('daily_challenges')
      .select('modifiers')
      .eq('date', dailyDate)
      .maybeSingle();
    cfg = applyDailyModifiers(cfg, (d?.modifiers ?? null) as Record<string, unknown> | null);
  }
  return cfg;
}
