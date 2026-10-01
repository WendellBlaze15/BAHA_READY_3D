import type { DifficultyConfig, SurvivalConfig } from './config.ts';

/**
 * Section 7 survival stats (0–100) and status effects, advanced in in-game minutes.
 * Owner rule: no stat ever slows walking. Lakas (energy) at 0 only locks sprint + jump until it
 * recovers to `energyUnlockAt`; the short-term sprint bar uses the shared stamina rules.
 */
export const STATUS_EFFECTS = [
  'stomach_illness',
  'infection',
  'open_wound',
  'hypothermia',
  'wet',
  'exhausted',
] as const;
export type StatusEffect = (typeof STATUS_EFFECTS)[number];

export type PlayerStats = {
  health: number;
  hunger: number;
  thirst: number;
  warmth: number;
  energy: number;
  /** Hidden leptospirosis risk meter (0–100) → infection at 100. */
  leptoRisk: number;
  effects: StatusEffect[];
};

export type StatEnv = {
  night: boolean;
  hot: boolean;
  raining: boolean;
  inWater: boolean;
  nearFire: boolean;
  sheltered: boolean;
  sleeping: boolean;
  wearingBoots: boolean;
  wearingRaincoat: boolean;
  /** Cold multiplier boost during storm nights. */
  storm: boolean;
};

export type StatEvent =
  | { type: 'effect_added'; effect: StatusEffect }
  | { type: 'effect_removed'; effect: StatusEffect }
  | { type: 'health_zero' };

export const freshStats = (): PlayerStats => ({
  health: 100,
  hunger: 100,
  thirst: 100,
  warmth: 100,
  energy: 100,
  leptoRisk: 0,
  effects: [],
});

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Advances stats by `minutes` in-game minutes. Pure: returns new stats + what changed. */
export function tickStats(
  s: PlayerStats,
  minutes: number,
  env: StatEnv,
  cfg: SurvivalConfig['stats'],
  diff: DifficultyConfig,
): { stats: PlayerStats; events: StatEvent[] } {
  const h = minutes / 60;
  const effects = new Set(s.effects);
  const events: StatEvent[] = [];
  const add = (e: StatusEffect) => {
    if (!effects.has(e)) {
      effects.add(e);
      events.push({ type: 'effect_added', effect: e });
    }
  };
  const remove = (e: StatusEffect) => {
    if (effects.delete(e)) events.push({ type: 'effect_removed', effect: e });
  };

  // Wet: in water, or rain without shelter or raincoat. Drying happens by the fire.
  if (env.inWater || (env.raining && !env.sheltered && !env.wearingRaincoat)) add('wet');
  else if (env.nearFire) remove('wet');

  const sick = effects.has('stomach_illness') ? 1.5 : 1;
  let hunger = s.hunger - cfg.hungerPerHour * diff.hungerDrainMul * sick * h;
  let thirst =
    s.thirst -
    cfg.thirstPerHour * diff.thirstDrainMul * sick * (env.hot ? cfg.thirstHeatMul : 1) * h;

  // Warmth: fire or dry shelter warms; night, storms and being wet chill.
  let warmth = s.warmth;
  if (env.nearFire || (env.sheltered && !effects.has('wet')))
    warmth += cfg.warmthRecoverPerHour * h;
  else {
    if (env.night) warmth -= cfg.warmthNightPerHour * diff.nightColdMul * (env.storm ? 1.5 : 1) * h;
    if (effects.has('wet')) warmth -= cfg.warmthWetPerHour * h;
  }

  let energy = s.energy + (env.sleeping ? cfg.energySleepPerHour : -cfg.energyAwakePerHour) * h;

  // Leptospirosis: wading/swimming with an open wound and no boots (prevention = boots + bandage).
  let leptoRisk = s.leptoRisk;
  if (env.inWater && effects.has('open_wound') && !env.wearingBoots)
    leptoRisk += cfg.leptoRiskPerMinute * minutes;
  if (leptoRisk >= 100) {
    leptoRisk = 0;
    add('infection');
  }

  hunger = clamp(hunger);
  thirst = clamp(thirst);
  warmth = clamp(warmth);
  energy = clamp(energy);

  if (warmth <= 0) add('hypothermia');
  else if (warmth > 30) remove('hypothermia');
  // Lakas lockout (sprint + jump only — never slower walking).
  if (energy <= 0) add('exhausted');
  else if (energy >= cfg.energyUnlockAt) remove('exhausted');

  let health = s.health;
  if (hunger <= 0) health -= cfg.starvingHealthPerHour * h;
  if (thirst <= 0) health -= cfg.dehydratedHealthPerHour * h;
  if (effects.has('hypothermia')) health -= cfg.hypothermiaHealthPerHour * h;
  if (effects.has('infection')) health -= 4 * h;
  if (effects.has('open_wound')) health -= 1 * h;
  const thriving =
    hunger > 50 &&
    thirst > 50 &&
    warmth > 50 &&
    !effects.has('stomach_illness') &&
    !effects.has('infection');
  if (thriving) health += cfg.healthRegenPerHour * (env.sleeping ? 2 : 1) * h;
  health = clamp(health);
  if (health <= 0 && s.health > 0) events.push({ type: 'health_zero' });

  return {
    stats: { health, hunger, thirst, warmth, energy, leptoRisk, effects: [...effects] },
    events,
  };
}

/** Sprint + jump are locked while out of Lakas (in addition to the short-term stamina lockout). */
export const sprintLocked = (s: PlayerStats) => s.effects.includes('exhausted');
