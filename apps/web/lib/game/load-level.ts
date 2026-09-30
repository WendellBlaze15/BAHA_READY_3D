import 'server-only';
import { levelConfigSchema } from '@baha/shared/level-config';
import type { GameContent } from '@baha/shared/game';
import { getSupabaseServer } from '@/lib/supabase/server';
import type { GameTexts } from '@/game/store/game-store';

/** Everything the game needs, fetched on the server (content is public; RLS applies). */
export async function loadLevelBundle(slug: string, locale: 'fil' | 'en') {
  const supabase = await getSupabaseServer();
  const { data: level } = await supabase
    .from('levels')
    .select('id, slug, name_fil, name_en, current_version_id, sort_order')
    .eq('slug', slug)
    .maybeSingle();
  if (!level?.current_version_id) return null;

  const [{ data: version }, items, tasks, hazards, npcs, tips, { data: next }] = await Promise.all([
    supabase.from('level_versions').select('config').eq('id', level.current_version_id).single(),
    supabase
      .from('gobag_items')
      .select(
        'key, name_fil, name_en, weight_kg, category, is_essential, points, explanation_fil, explanation_en',
      ),
    supabase
      .from('home_tasks')
      .select('key, name_fil, name_en, points, explanation_fil, explanation_en'),
    supabase
      .from('hazards')
      .select('key, name_fil, name_en, penalty, instant_fail, explanation_fil, explanation_en'),
    supabase.from('npc_types').select('key, name_fil, name_en, points, needs'),
    supabase
      .from('tips')
      .select('title_fil, title_en')
      .eq('unlock_rule->>type', 'always')
      .limit(12),
    supabase
      .from('levels')
      .select('slug')
      .gt('sort_order', level.sort_order)
      .order('sort_order')
      .limit(1)
      .maybeSingle(),
  ]);
  const config = levelConfigSchema.parse(version?.config);
  const L = (fil: string, en: string) => (locale === 'en' ? en : fil);

  const content: GameContent = {
    items: (items.data ?? []).map((i) => ({
      key: i.key,
      weight_kg: Number(i.weight_kg),
      category: i.category,
      is_essential: i.is_essential,
      points: i.points,
    })),
    tasks: (tasks.data ?? []).map((i) => ({ key: i.key, points: i.points })),
    hazards: (hazards.data ?? []).map((i) => ({
      key: i.key,
      penalty: i.penalty,
      instant_fail: i.instant_fail,
    })),
    npcs: (npcs.data ?? []).map((i) => ({
      key: i.key,
      points: i.points,
      needs: (i.needs ?? {}) as Record<string, unknown>,
    })),
  };
  const texts: GameTexts = {
    items: Object.fromEntries(
      (items.data ?? []).map((i) => [
        i.key,
        { name: L(i.name_fil, i.name_en), explanation: L(i.explanation_fil, i.explanation_en) },
      ]),
    ),
    tasks: Object.fromEntries(
      (tasks.data ?? []).map((i) => [
        i.key,
        { name: L(i.name_fil, i.name_en), explanation: L(i.explanation_fil, i.explanation_en) },
      ]),
    ),
    hazards: Object.fromEntries(
      (hazards.data ?? []).map((i) => [
        i.key,
        { name: L(i.name_fil, i.name_en), explanation: L(i.explanation_fil, i.explanation_en) },
      ]),
    ),
    npcs: Object.fromEntries(
      (npcs.data ?? []).map((i) => [i.key, { name: L(i.name_fil, i.name_en), explanation: '' }]),
    ),
  };

  return {
    level: {
      id: level.id,
      slug: level.slug,
      name: L(level.name_fil, level.name_en),
      signal: config.signal,
    },
    config,
    content,
    texts,
    tips: (tips.data ?? []).map((t) => L(t.title_fil, t.title_en)),
    nextSlug: next?.slug ?? null,
  };
}
