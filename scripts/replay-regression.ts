// Anti-cheat regression: re-scores every stored attempt with the CURRENT shared scoring code and
// reports any run that was clean before but would be flagged now (false positives), plus any
// flagged run that would now pass. Read-only. Run before deploying scoring changes.
// Usage: node scripts/with-env.mjs pnpm exec tsx scripts/replay-regression.ts
import path from 'node:path';
import { createRequire } from 'node:module';
import { levelConfigSchema } from '../packages/shared/src/level-config.ts';
import {
  applyDailyModifiers,
  computeResult,
  generateLayout,
  type GameContent,
  type GameEvent,
} from '../packages/shared/src/game/index.ts';

const requireWeb = createRequire(path.resolve('apps/web/package.json'));
const { createClient } = requireWeb(
  '@supabase/supabase-js',
) as typeof import('@supabase/supabase-js');
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  },
);

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

const { data: attempts, error } = await admin
  .from('attempts')
  .select('id, level_version_id, seed, flag_reasons, score, mode, daily_date, status')
  .in('status', ['completed', 'failed', 'voided'])
  .limit(2000);
if (error) throw error;
const versionCache = new Map<string, unknown>();
let checked = 0;
let newFlags = 0;
let cleared = 0;
let scoreChanged = 0;
for (const a of attempts ?? []) {
  const { data: ev } = await admin
    .from('attempt_events')
    .select('events')
    .eq('attempt_id', a.id)
    .maybeSingle();
  if (!ev?.events) continue;
  if (!versionCache.has(a.level_version_id)) {
    const { data } = await admin
      .from('level_versions')
      .select('config')
      .eq('id', a.level_version_id)
      .single();
    versionCache.set(a.level_version_id, data?.config);
  }
  let cfg = levelConfigSchema.parse(versionCache.get(a.level_version_id));
  if (a.mode === 'daily' && a.daily_date) {
    const { data: d } = await admin
      .from('daily_challenges')
      .select('modifiers')
      .eq('date', a.daily_date)
      .maybeSingle();
    cfg = applyDailyModifiers(cfg, (d?.modifiers ?? null) as Record<string, unknown> | null);
  }
  const r = computeResult(
    cfg,
    content,
    generateLayout(cfg, String(a.seed)),
    ev.events as GameEvent[],
  );
  checked++;
  const before = new Set<string>(a.flag_reasons ?? []);
  const now = new Set<string>(r.flags);
  const added = [...now].filter((f) => !before.has(f));
  const removed = [...before].filter((f) => !now.has(f));
  if (added.length) {
    newFlags++;
    console.log(`✘ NEW FLAGS on ${a.id} (${a.status}): ${added.join(', ')}`);
  }
  if (removed.length) {
    cleared++;
    console.log(`• flags no longer raised on ${a.id}: ${removed.join(', ')}`);
  }
  if (a.score !== null && a.status !== 'voided' && r.score !== a.score) scoreChanged++;
}
console.log(
  `\nre-scored ${checked} stored attempts: ${newFlags} newly flagged (false-positive risk), ${cleared} with flags cleared, ${scoreChanged} with a different score (content edits since)`,
);
process.exitCode = newFlags ? 1 : 0;
