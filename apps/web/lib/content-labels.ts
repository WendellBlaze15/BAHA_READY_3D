import 'server-only';
import { getSupabaseServer } from '@/lib/supabase/server';

/** Bilingual names for items, tasks, hazards and NPCs (for mistake keys in charts/reports). */
export async function contentLabels() {
  const supabase = await getSupabaseServer();
  const [items, tasks, hazards, npcs] = await Promise.all([
    supabase.from('gobag_items').select('key, name_fil, name_en'),
    supabase.from('home_tasks').select('key, name_fil, name_en'),
    supabase.from('hazards').select('key, name_fil, name_en'),
    supabase.from('npc_types').select('key, name_fil, name_en'),
  ]);
  const out: Record<string, { fil: string; en: string }> = {};
  for (const r of [
    ...(items.data ?? []),
    ...(tasks.data ?? []),
    ...(hazards.data ?? []),
    ...(npcs.data ?? []),
  ]) {
    out[r.key] = { fil: r.name_fil, en: r.name_en };
  }
  return out;
}
