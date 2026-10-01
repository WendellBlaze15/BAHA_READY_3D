import type {
  BoatStageDef,
  Difficulty,
  DifficultyConfig,
  ItemDef,
  SurvivalConfig,
} from './config.ts';
import type { ZoneKey } from './map/types.ts';
import type { StateRng } from './rng.ts';

/** Team scaling (Section 5): requirements × (1 + teamScale × (players − 1)). */
export const teamScale = (players: number, cfg: SurvivalConfig['session']) =>
  1 + cfg.teamScale * Math.max(0, players - 1);

/** Boat stage materials for this run (difficulty × team size), rounded up. */
export function scaledBoatMaterials(
  stage: BoatStageDef,
  diff: DifficultyConfig,
  players: number,
  session: SurvivalConfig['session'],
) {
  const k = diff.boatMaterialMul * teamScale(players, session);
  return stage.materials.map((m) => ({ item: m.item, qty: Math.ceil(m.qty * k) }));
}

const RARITY_WEIGHT = { common: 1, uncommon: 0.35, rare: 0.08 } as const;

/**
 * Seeded loot for one container (Section 8.4): zone × difficulty × day range — rarer items
 * become likelier later in the run. Returns item stacks.
 */
export function rollLoot(opts: {
  zone: ZoneKey;
  day: number;
  items: ItemDef[];
  diff: DifficultyConfig;
  players: number;
  session: SurvivalConfig['session'];
  rng: StateRng;
}): { item: string; qty: number }[] {
  const pool = opts.items.filter((i) => i.zones.includes(opts.zone));
  if (!pool.length) return [];
  const late = Math.min(1, opts.day / 20); // rare odds grow toward Day 20
  const weight = (i: ItemDef) =>
    RARITY_WEIGHT[i.rarity] *
    (i.rarity === 'rare' ? 1 + 2 * late : i.rarity === 'uncommon' ? 1 + late : 1);
  const total = pool.reduce((s, i) => s + weight(i), 0);
  const draws = Math.max(
    1,
    Math.round(
      opts.rng.range(1, 3) *
        opts.diff.lootMultiplier *
        Math.sqrt(teamScale(opts.players, opts.session)),
    ),
  );
  const out = new Map<string, number>();
  for (let n = 0; n < draws; n++) {
    let roll = opts.rng.next() * total;
    for (const i of pool) {
      roll -= weight(i);
      if (roll <= 0) {
        const qty =
          i.stack > 1 ? opts.rng.int(1, Math.min(i.stack, i.category === 'material' ? 4 : 2)) : 1;
        out.set(i.key, (out.get(i.key) ?? 0) + qty);
        break;
      }
    }
  }
  return [...out].map(([item, qty]) => ({ item, qty }));
}

/** Storm schedule for a run: scheduled days + seeded random extra storms (Hard). */
export function stormSchedule(diff: DifficultyConfig, totalDays: number, rng: StateRng) {
  const days = new Set(diff.stormDays.filter((d) => d < totalDays));
  for (let i = 0; i < diff.randomStorms; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const d = rng.int(3, totalDays - 2);
      if (![...days].some((x) => Math.abs(x - d) < 2)) {
        days.add(d);
        break;
      }
    }
  }
  return [...days].sort((a, b) => a - b);
}

// ── Downed / death / respawn (Section 12) ───────────────────────────────
export type DeathOutcome = {
  /** Respawn at camp next dawn (Easy/Normal) vs spectator for the rest of the run (Hard). */
  respawnAtDawn: boolean;
  spectator: boolean;
  /** Bag handling. */
  bag: 'keep' | 'drop_at_death_spot';
  /** Stat penalty applied on respawn (Easy: −20% of each stat). */
  statPenaltyRatio: number;
};

export function deathOutcome(diff: DifficultyConfig): DeathOutcome {
  switch (diff.deathPenalty) {
    case 'keep_bag':
      return { respawnAtDawn: true, spectator: false, bag: 'keep', statPenaltyRatio: 0.2 };
    case 'drop_bag':
      return {
        respawnAtDawn: true,
        spectator: false,
        bag: 'drop_at_death_spot',
        statPenaltyRatio: 0,
      };
    case 'permadeath':
      return {
        respawnAtDawn: false,
        spectator: true,
        bag: 'drop_at_death_spot',
        statPenaltyRatio: 0,
      };
  }
}

/** Everyone dead at once: Easy/Normal respawn at dawn and lose a day of boat work; Hard = run lost. */
export function allDeadOutcome(difficulty: Difficulty): 'respawn_with_boat_penalty' | 'run_lost' {
  return difficulty === 'hard' ? 'run_lost' : 'respawn_with_boat_penalty';
}

/** Revive hold time (Medic faster; solo Second Wind is its own, longer hold). */
export function reviveSeconds(
  session: SurvivalConfig['session'],
  reviverRole: string,
  solo: boolean,
) {
  if (solo) return session.secondWindSeconds;
  return reviverRole === 'medic' ? session.medicReviveSeconds : session.reviveSeconds;
}

/** Health after a revive: bandage 30%, first-aid kit 60% (Section 12.2). */
export const reviveHealth = (item: 'bandage' | 'first_aid_kit') =>
  item === 'first_aid_kit' ? 60 : 30;

// ── Scoring (Section 14.3, server-computed) ─────────────────────────────
export type Ending = 'full_rescue' | 'partial_rescue' | 'failed';

export type RunSummary = {
  daysSurvived: number;
  boatStagesCompleted: number;
  playersRescued: number;
  npcsRescued: number;
  campLevel: number;
  goodActions: number;
  deaths: number;
  hazardHits: number;
  sicknessEvents: number;
  ending: Ending;
};

export function survivalScore(
  s: RunSummary,
  cfg: SurvivalConfig['scoring'],
  diff: DifficultyConfig,
) {
  const base =
    s.daysSurvived * cfg.perDay +
    s.boatStagesCompleted * cfg.perBoatStage +
    s.playersRescued * cfg.perPlayerRescued +
    s.npcsRescued * cfg.perNpcRescued +
    s.campLevel * cfg.perCampLevel +
    s.goodActions * cfg.perGoodAction -
    s.deaths * cfg.deathPenalty -
    s.hazardHits * cfg.hazardPenalty -
    s.sicknessEvents * cfg.sicknessPenalty;
  const final = Math.max(0, base) * diff.rewardMultiplier * cfg.endingMultiplier[s.ending];
  return { base, final: Math.round(final) };
}

/**
 * Ending (Section 14.2): full = everyone who was alive at the window got rescued; partial = at
 * least one rescued; failed = nobody (or no boat + signal).
 */
export function decideEnding(opts: {
  rescued: number;
  aliveAtWindow: number;
  boatComplete: boolean;
  signalActive: boolean;
}): Ending {
  if (!opts.boatComplete || !opts.signalActive || opts.rescued === 0) return 'failed';
  return opts.rescued >= opts.aliveAtWindow ? 'full_rescue' : 'partial_rescue';
}
