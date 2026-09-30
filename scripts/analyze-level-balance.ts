// Level balance after adding energy-limited sprint: how much faster can an evacuation route be
// done, and what evacTimeSec keeps the same challenge? Read-only (never publishes).
// Usage: node scripts/with-env.mjs pnpm exec tsx scripts/analyze-level-balance.ts
import path from 'node:path';
import { createRequire } from 'node:module';
import { levelConfigSchema } from '../packages/shared/src/level-config.ts';
import {
  dist,
  generateLayout,
  initialSprintState,
  setSprintIntent,
  stepSprint,
  withActions,
  type Vec2,
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

const WALK = 4.6; // client dry-ground speed (game/entities/Player.tsx BASE_SPEED)
const SEEDS = 200;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

/** Route a real player follows: start → nearest NPC … → evacuation waypoints. */
function routeLength(layout: ReturnType<typeof generateLayout>) {
  let pos: Vec2 = layout.start;
  let len = 0;
  const left = [...layout.npcs.map((n) => n.pos)];
  while (left.length) {
    left.sort((a, b) => dist(pos, a) - dist(pos, b));
    const n = left.shift()!;
    len += dist(pos, n);
    pos = n;
  }
  for (const w of layout.route.slice(1)) {
    len += dist(pos, w);
    pos = w;
  }
  return len;
}

/** Seconds to cover `len` metres holding sprint the whole way (best case under stamina rules). */
function sprintTime(len: number, actions: ReturnType<typeof withActions>) {
  let s = setSprintIntent(initialSprintState(), true);
  let covered = 0;
  let t = 0;
  while (covered < len && t < 3600) {
    const r = stepSprint(s, 0.1, actions);
    covered += WALK * (0.1 + (actions.sprintMultiplier - 1) * r.sprintSeconds);
    s = r.state;
    t += 0.1;
  }
  return t;
}

const { data: levelRows, error } = await admin
  .from('levels')
  .select('id, slug, current_version_id')
  .order('id');
if (error) throw error;
const { data: versions } = await admin
  .from('level_versions')
  .select('id, version, config')
  .in(
    'id',
    (levelRows ?? []).map((l) => l.current_version_id),
  );
const levels = (levelRows ?? []).map((l) => ({
  ...l,
  level_versions: versions!.find((v) => v.id === l.current_version_id)!,
}));

console.log(
  'Assumes dry ground (sprint is disabled in waist/chest-deep water), so savings are an upper bound.\n',
);
const rows = [];
for (const l of levels) {
  const lv = l.level_versions;
  const cfg = levelConfigSchema.parse(lv.config);
  const a = withActions(cfg.actions);
  const lens: number[] = [];
  for (let s = 1; s <= SEEDS; s++) lens.push(routeLength(generateLayout(cfg, BigInt(s * 7919))));
  const len = median(lens);
  const walkSec = len / WALK;
  const sprintSec = sprintTime(len, a);
  const saved = walkSec - sprintSec;

  const { data: att } = await admin
    .from('attempts')
    .select('summary')
    .eq('level_id', l.id)
    .eq('status', 'completed')
    .eq('mode', 'normal')
    .eq('level_version_id', l.current_version_id)
    .limit(500);
  const used = (att ?? [])
    .map((x) => (x.summary as { timeRemainingSec?: number } | null)?.timeRemainingSec)
    .filter((v): v is number => typeof v === 'number')
    .map((rem) => cfg.evacTimeSec - rem);

  const tb = cfg.scoring.timeBonusPerSec;
  const proposed = cfg.tutorial ? cfg.evacTimeSec : Math.max(60, ceil5(cfg.evacTimeSec - saved));
  rows.push({
    level: l.slug,
    v: lv.version,
    routeM: Math.round(len),
    walkSec: Math.round(walkSec),
    sprintSec: Math.round(sprintSec),
    savedSec: Math.round(saved),
    savedPct: `${Math.round((saved / walkSec) * 100)}%`,
    realRuns: used.length,
    realMedianEvacSec: used.length ? Math.round(median(used)) : '—',
    evacTimeSec: cfg.evacTimeSec,
    proposedEvacTimeSec: proposed,
    maxExtraBonusIfUnchanged: Math.round(saved * tb),
  });
}
console.table(rows);
