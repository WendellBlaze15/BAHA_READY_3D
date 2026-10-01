import { z } from 'zod';
import {
  DEFAULT_ACTIONS,
  DEFAULT_CAMERA,
  cameraConfigSchema,
  levelActionsSchema,
} from '../level-config.ts';

/**
 * Survival Mode configuration (stored in survival_config_versions.config; runs pin a version).
 * Every gameplay number lives here — never hardcode them in the client or game server.
 * Time units: in-game minutes (a day = 1440 in-game minutes = `minutesPerDay` real minutes).
 */

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const ROLES = ['medic', 'builder', 'scout', 'cook', 'radio'] as const;
export type Role = (typeof ROLES)[number] | 'solo';

const key = z.string().regex(/^[a-z0-9_]{2,40}$/);
const bilingual = z.object({ fil: z.string().min(1).max(300), en: z.string().min(1).max(300) });
const hour = z.number().min(0).max(24);

export const difficultySchema = z
  .object({
    /** Real minutes per in-game day. */
    minutesPerDay: z.number().min(1).max(60),
    lootMultiplier: z.number().min(0.1).max(5),
    hungerDrainMul: z.number().min(0.1).max(5),
    thirstDrainMul: z.number().min(0.1).max(5),
    nightColdMul: z.number().min(0.1).max(5),
    /** Scheduled storm nights (day numbers). */
    stormDays: z.array(z.number().int().min(1).max(30)),
    /** Extra random storms per run. */
    randomStorms: z.number().int().min(0).max(10),
    /** Flood water rise per storm (m). */
    waterRisePerStorm: z.number().min(0).max(2),
    bleedOutSec: z.number().int().min(5).max(300),
    deathPenalty: z.enum(['keep_bag', 'drop_bag', 'permadeath']),
    /** Solo self-revives per run. */
    secondWinds: z.number().int().min(0).max(10),
    boatMaterialMul: z.number().min(0.1).max(5),
    supplyDropEveryDays: z.number().int().min(1).max(30),
    /** 0..2 — hazard spawn density multiplier. */
    hazardDensity: z.number().min(0).max(2),
    heliWindow: z.object({ start: hour, end: hour }),
    rewardMultiplier: z.number().min(0.1).max(10),
  })
  .strict();

export const itemCategorySchema = z.enum([
  'food',
  'water',
  'medical',
  'clothing',
  'tool',
  'material',
  'signal',
  'special',
]);

/** What using an item does (applied by the server). */
export const itemUseSchema = z
  .object({
    hunger: z.number().optional(),
    thirst: z.number().optional(),
    health: z.number().optional(),
    warmth: z.number().optional(),
    energy: z.number().optional(),
    /** Status effects removed / added by using this item. */
    cures: z.array(key).optional(),
    causes: z.array(z.object({ effect: key, chance: z.number().min(0).max(1) })).optional(),
    /** Learning event recorded when used (e.g. drank_boiled_water). */
    learning: key.optional(),
    /** Equip into a hand/body slot instead of consuming. */
    equip: z.enum(['hand', 'body', 'feet']).optional(),
  })
  .strict();

export const itemSchema = z
  .object({
    key,
    name: bilingual,
    category: itemCategorySchema,
    weightKg: z.number().min(0).max(30),
    stack: z.number().int().min(1).max(200),
    rarity: z.enum(['common', 'uncommon', 'rare']),
    /** Zones where it can spawn as loot. */
    zones: z.array(key),
    use: itemUseSchema.optional(),
    /** Tools: uses before breaking (axe swings, lighter strikes…). */
    durability: z.number().int().min(1).max(1000).optional(),
    lesson: bilingual.optional(),
  })
  .strict();

export const recipeSchema = z
  .object({
    key,
    name: bilingual,
    inputs: z.array(z.object({ item: key, qty: z.number().int().min(1).max(100) })).min(1),
    /** Tools needed but not consumed. */
    tools: z.array(key).default([]),
    output: z.object({ item: key, qty: z.number().int().min(1).max(50) }).optional(),
    /** Camp structures (campfire, shelter…) instead of an item. */
    structure: key.optional(),
    where: z.enum(['anywhere', 'camp', 'workbench2', 'signal_spot']),
    /** Needs a lit campfire nearby (boiling, cooking). */
    needsFire: z.boolean().default(false),
    seconds: z.number().min(0.5).max(120),
    lesson: bilingual.optional(),
  })
  .strict();

export const boatStageSchema = z
  .object({
    stage: z.number().int().min(1).max(6),
    name: bilingual,
    materials: z.array(z.object({ item: key, qty: z.number().int().min(1).max(200) })).min(1),
    tools: z.array(key).default([]),
    /** Build work (player-seconds) once materials are in. */
    workSeconds: z.number().min(5).max(1200),
    targetDay: z.number().int().min(1).max(30),
    /** Requires camp workbench tier 2. */
    workbench2: z.boolean().default(false),
  })
  .strict();

export const statsSchema = z
  .object({
    /** Per in-game hour. */
    hungerPerHour: z.number().min(0).max(50),
    thirstPerHour: z.number().min(0).max(50),
    /** Extra thirst multiplier during the hot day (10:00–16:00). */
    thirstHeatMul: z.number().min(1).max(3),
    warmthNightPerHour: z.number().min(0).max(50),
    warmthWetPerHour: z.number().min(0).max(50),
    warmthRecoverPerHour: z.number().min(0).max(100),
    energyAwakePerHour: z.number().min(0).max(50),
    energySleepPerHour: z.number().min(0).max(100),
    /** Health drain per hour while hunger / thirst / warmth are at 0. */
    starvingHealthPerHour: z.number().min(0).max(100),
    dehydratedHealthPerHour: z.number().min(0).max(100),
    hypothermiaHealthPerHour: z.number().min(0).max(100),
    /** Natural health regen per hour when fed, hydrated and warm (> 50). */
    healthRegenPerHour: z.number().min(0).max(50),
    /** Lakas at 0 → sprint and jump locked (never slower walking) until it reaches this. */
    energyUnlockAt: z.number().min(0).max(100),
    /** Leptospirosis risk gained per in-game minute wading with an open wound and no boots. */
    leptoRiskPerMinute: z.number().min(0).max(10),
    /** Chance per unsafe drink to cause stomach illness. */
    unsafeWaterSicknessChance: z.number().min(0).max(1),
  })
  .strict();

export const meleeSchema = z
  .object({
    /** Axe swing (needs an equipped Palakol). */
    axeRangeM: z.number().min(0.5).max(5),
    axeArcDeg: z.number().min(10).max(360),
    axeCooldownSec: z.number().min(0.1).max(5),
    axeStaminaCost: z.number().min(0).max(50),
    /** Wood yielded per chop on a chop target. */
    woodPerChop: z.number().int().min(1).max(10),
    /** Shove without an axe: knockback only. */
    shoveRangeM: z.number().min(0.5).max(3),
    shoveCooldownSec: z.number().min(0.1).max(5),
    shoveStaminaCost: z.number().min(0).max(50),
  })
  .strict();

export const chatConfigSchema = z
  .object({
    maxLength: z.number().int().min(20).max(500),
    minIntervalMs: z.number().int().min(0).max(10000),
    perMinute: z.number().int().min(1).max(120),
    duplicateLimit: z.number().int().min(2).max(10),
    autoMuteHits: z.number().int().min(1).max(20),
    autoMuteWindowMin: z.number().min(1).max(60),
    /** Escalating auto-mute minutes within 24 h. */
    muteMinutes: z.array(z.number().int().min(1).max(1440)).min(1),
    quickChatIntervalMs: z.number().int().min(0).max(10000),
    pingIntervalMs: z.number().int().min(0).max(10000),
    retentionDays: z.number().int().min(1).max(90),
  })
  .strict();

export const sessionConfigSchema = z
  .object({
    maxPlayers: z.number().int().min(1).max(5),
    minCoopPlayers: z.number().int().min(2).max(5),
    totalDays: z.number().int().min(1).max(30),
    startHour: hour,
    dawnHour: hour,
    nightStartHour: hour,
    autoSaveEverySec: z.number().int().min(30).max(600),
    reconnectSec: z.number().int().min(10).max(600),
    lobbyIdleMin: z.number().int().min(1).max(120),
    cutsceneMaxWaitSec: z.number().int().min(5).max(300),
    sleepSpeedup: z.number().min(1).max(10),
    maxActiveRuns: z.number().int().min(1).max(10),
    runExpiryDays: z.number().int().min(1).max(90),
    respawnProtectionSec: z.number().min(0).max(30),
    reviveSeconds: z.number().min(1).max(30),
    medicReviveSeconds: z.number().min(1).max(30),
    secondWindSeconds: z.number().min(1).max(30),
    /** Team scaling: requirements × (1 + teamScale × (players − 1)). */
    teamScale: z.number().min(0).max(1),
    soloPerkStrength: z.number().min(0).max(1),
  })
  .strict();

export const bagConfigSchema = z
  .object({
    slots: z.number().int().min(4).max(40),
    quickSlots: z.number().int().min(1).max(8),
    maxWeightKg: z.number().min(1).max(100),
    /** Above this share of max weight: slower movement (lesson: pack light). */
    slowAtRatio: z.number().min(0.1).max(1),
    slowMultiplier: z.number().min(0.1).max(1),
  })
  .strict();

export const roleSchema = z
  .object({
    reviveSpeedMul: z.number().min(0.1).max(5).default(1),
    healMul: z.number().min(0.1).max(5).default(1),
    buildSpeedMul: z.number().min(0.1).max(5).default(1),
    materialSaveRatio: z.number().min(0).max(0.9).default(0),
    swimSpeedMul: z.number().min(0.1).max(5).default(1),
    lootHighlightRadiusM: z.number().min(0).max(200).default(0),
    cookHungerMul: z.number().min(0.1).max(5).default(1),
    earlyWarningMin: z.number().min(0).max(1440).default(0),
  })
  .strict();

/** Camp upgrades (Section 9.2): level 2 unlocks workbench tier 2 (later boat stages). */
export const campUpgradeSchema = z
  .object({
    level: z.number().int().min(2).max(3),
    materials: z.array(z.object({ item: key, qty: z.number().int().min(1).max(200) })).min(1),
    workSeconds: z.number().min(5).max(1200),
    workbenchTier: z.number().int().min(1).max(3),
  })
  .strict();

export const DEFAULT_CAMP_UPGRADES = [
  {
    level: 2,
    materials: [
      { item: 'wood', qty: 10 },
      { item: 'nails', qty: 15 },
      { item: 'tarp', qty: 1 },
    ],
    workSeconds: 40,
    workbenchTier: 2,
  },
  {
    level: 3,
    materials: [
      { item: 'wood', qty: 15 },
      { item: 'metal_sheet', qty: 3 },
      { item: 'rope', qty: 4 },
    ],
    workSeconds: 60,
    workbenchTier: 2,
  },
];

/** Scheduled/random events, downed/death timings and the Day-30 rescue (Sections 10, 12, 13, 14). */
export const eventsConfigSchema = z
  .object({
    radioHour: hour,
    supplyDropHour: hour,
    /** Storm damage when the build site / storage are not covered. */
    stormBoatProgressLoss: z.number().min(0).max(1),
    stormStorageLossRatio: z.number().min(0).max(1),
    /** Share of looted containers that refill after a storm (floating debris always refills). */
    debrisRespawnRatio: z.number().min(0).max(1),
    /** A dead player's dropped bag stays this many in-game days. */
    droppedBagDays: z.number().min(0.5).max(10),
    /** Easy/Normal: stat loss on respawn is per difficulty; all-dead loses this much stage progress. */
    allDeadBoatProgressLoss: z.number().min(0).max(1),
    downedCrawlSpeedMul: z.number().min(0).max(1),
    /** Days without help before a stranded survivor is evacuated by others (lost for the score). */
    survivorWaitDays: z.number().int().min(1).max(30),
    /** Real seconds the boat takes from the dock to the rescue point. */
    boatTravelSec: z.number().min(5).max(600),
    heliArriveSec: z.number().min(0).max(120),
    heliLiftSecPerPlayer: z.number().min(0.5).max(30),
    campfireBurnHours: z.number().min(1).max(48),
  })
  .strict();

export const DEFAULT_EVENTS = {
  radioHour: 7,
  supplyDropHour: 9,
  stormBoatProgressLoss: 0.25,
  stormStorageLossRatio: 0.2,
  debrisRespawnRatio: 0.3,
  droppedBagDays: 2,
  allDeadBoatProgressLoss: 0.5,
  downedCrawlSpeedMul: 0.3,
  survivorWaitDays: 4,
  boatTravelSec: 120,
  heliArriveSec: 10,
  heliLiftSecPerPlayer: 3,
  campfireBurnHours: 8,
};

/** Hazard rules (Section 13.2) — warnings always come before danger. */
export const hazardsConfigSchema = z
  .object({
    warnRadiusM: z.number().min(1).max(30),
    /** Live wires: entering water inside the zone downs the player instantly. */
    liveWireLethal: z.boolean(),
    currentPushMps: z.number().min(0).max(10),
    currentHealthPerMin: z.number().min(0).max(50),
    ratBiteChancePerMin: z.number().min(0).max(1),
    snakeBiteChancePerMin: z.number().min(0).max(1),
    snakeDamage: z.number().min(0).max(100),
    collapseChancePerHour: z.number().min(0).max(1),
    collapseWarnSec: z.number().min(1).max(30),
    collapseDamage: z.number().min(0).max(100),
    /** Axe/shove scares critters away from you for this long (s). */
    critterScareSec: z.number().min(0).max(600),
  })
  .strict();

export const DEFAULT_HAZARDS = {
  warnRadiusM: 6,
  liveWireLethal: true,
  currentPushMps: 1.5,
  currentHealthPerMin: 2,
  ratBiteChancePerMin: 0.15,
  snakeBiteChancePerMin: 0.08,
  snakeDamage: 10,
  collapseChancePerHour: 0.1,
  collapseWarnSec: 5,
  collapseDamage: 25,
  critterScareSec: 60,
};

export const scoringSchema = z
  .object({
    perDay: z.number(),
    perBoatStage: z.number(),
    perPlayerRescued: z.number(),
    perNpcRescued: z.number(),
    perCampLevel: z.number(),
    perGoodAction: z.number(),
    deathPenalty: z.number(),
    hazardPenalty: z.number(),
    sicknessPenalty: z.number(),
    endingMultiplier: z
      .object({ full_rescue: z.number(), partial_rescue: z.number(), failed: z.number() })
      .strict(),
  })
  .strict();

export const survivalConfigSchema = z
  .object({
    difficulties: z.object({
      easy: difficultySchema,
      normal: difficultySchema,
      hard: difficultySchema,
    }),
    stats: statsSchema,
    bag: bagConfigSchema,
    items: z.array(itemSchema).min(1),
    recipes: z.array(recipeSchema),
    boatStages: z.array(boatStageSchema).length(6),
    roles: z.object({
      medic: roleSchema,
      builder: roleSchema,
      scout: roleSchema,
      cook: roleSchema,
      radio: roleSchema,
    }),
    melee: meleeSchema,
    /** Same jump/sprint rules as the Signal levels (no slow-motion when exhausted). */
    actions: levelActionsSchema.default({ ...DEFAULT_ACTIONS }),
    camera: cameraConfigSchema.default({ ...DEFAULT_CAMERA }),
    chat: chatConfigSchema,
    session: sessionConfigSchema,
    scoring: scoringSchema,
    /** NPC stranded survivors per run (min/max). */
    survivors: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
    // Added after v1 (defaults keep earlier published versions valid).
    campUpgrades: z.array(campUpgradeSchema).max(2).default(DEFAULT_CAMP_UPGRADES),
    events: eventsConfigSchema.default({ ...DEFAULT_EVENTS }),
    hazards: hazardsConfigSchema.default({ ...DEFAULT_HAZARDS }),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const items = new Set(cfg.items.map((i) => i.key));
    const check = (k: string, path: (string | number)[]) => {
      if (!items.has(k)) ctx.addIssue({ code: 'custom', message: `unknown item "${k}"`, path });
    };
    cfg.recipes.forEach((r, i) => {
      r.inputs.forEach((x, j) => check(x.item, ['recipes', i, 'inputs', j]));
      r.tools.forEach((t, j) => check(t, ['recipes', i, 'tools', j]));
      if (r.output) check(r.output.item, ['recipes', i, 'output']);
      if (!r.output && !r.structure)
        ctx.addIssue({
          code: 'custom',
          message: 'recipe needs an output or a structure',
          path: ['recipes', i],
        });
    });
    cfg.boatStages.forEach((s, i) => {
      if (s.stage !== i + 1)
        ctx.addIssue({
          code: 'custom',
          message: 'stages must be 1..6 in order',
          path: ['boatStages', i],
        });
      s.materials.forEach((m, j) => check(m.item, ['boatStages', i, 'materials', j]));
      s.tools.forEach((t, j) => check(t, ['boatStages', i, 'tools', j]));
    });
    cfg.campUpgrades.forEach((u, i) =>
      u.materials.forEach((m, j) => check(m.item, ['campUpgrades', i, 'materials', j])),
    );
    if (new Set(cfg.items.map((i) => i.key)).size !== cfg.items.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate item keys', path: ['items'] });
    if (cfg.survivors.max < cfg.survivors.min)
      ctx.addIssue({ code: 'custom', message: 'survivors.max < min', path: ['survivors'] });
  });

export type SurvivalConfig = z.infer<typeof survivalConfigSchema>;
export type ItemDef = z.infer<typeof itemSchema>;
export type RecipeDef = z.infer<typeof recipeSchema>;
export type BoatStageDef = z.infer<typeof boatStageSchema>;
export type DifficultyConfig = z.infer<typeof difficultySchema>;
export type CampUpgradeDef = z.infer<typeof campUpgradeSchema>;
