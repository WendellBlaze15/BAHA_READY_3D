import { z } from 'zod';

/**
 * Level configuration stored in `level_versions.config`.
 * Every gameplay number comes from here — never hardcode them in components.
 * Shared by the admin editor, the client game, and the authoritative Edge Functions.
 */
export const levelMapSchema = z.enum([
  'house',
  'street',
  'plaza',
  'palengke',
  'night_town',
  'town',
]);

/** Movement actions (jump, energy-limited sprint). Defaults keep older level versions valid. */
export const DEFAULT_ACTIONS = {
  sprintMultiplier: 1.6,
  sprintDrainPerSec: 12,
  staminaRegenPerSec: 5,
  /** Sprint can't start below this stamina… */
  sprintMinStartStamina: 10,
  /** …and after running empty ("Hingal"), it stays locked until stamina recovers to this. */
  sprintResumeStamina: 25,
  jumpEnabled: true,
  jumpStaminaCost: 4,
} as const;

export const levelActionsSchema = z
  .object({
    sprintMultiplier: z.number().min(1).max(2.5).default(DEFAULT_ACTIONS.sprintMultiplier),
    sprintDrainPerSec: z.number().min(0).max(50).default(DEFAULT_ACTIONS.sprintDrainPerSec),
    staminaRegenPerSec: z.number().min(0).max(50).default(DEFAULT_ACTIONS.staminaRegenPerSec),
    sprintMinStartStamina: z
      .number()
      .min(0)
      .max(100)
      .default(DEFAULT_ACTIONS.sprintMinStartStamina),
    sprintResumeStamina: z.number().min(0).max(100).default(DEFAULT_ACTIONS.sprintResumeStamina),
    jumpEnabled: z.boolean().default(DEFAULT_ACTIONS.jumpEnabled),
    jumpStaminaCost: z.number().min(0).max(50).default(DEFAULT_ACTIONS.jumpStaminaCost),
  })
  .strict();

export const levelConfigSchema = z
  .object({
    signal: z.number().int().min(0).max(5),
    map: levelMapSchema,
    tutorial: z.boolean().default(false),
    /** null = untimed (tutorial). */
    prepTimeSec: z.number().int().min(20).max(600).nullable(),
    evacTimeSec: z.number().int().min(30).max(600),
    /** Minimum plausible duration for anti-cheat (seconds, whole attempt). */
    minDurationSec: z.number().int().min(5).max(600),
    weightLimitKg: z.number().min(1).max(30),
    /** Water rise speed in meters per second of evacuation time. */
    waterRiseSpeed: z.number().min(0).max(0.2),
    /** 0..1 */
    rainIntensity: z.number().min(0).max(1),
    /** 0..1 lateral current force multiplier in current zones. */
    currentStrength: z.number().min(0).max(1),
    night: z.boolean(),
    lightning: z.boolean(),
    /** Player max speed in m/s (anti-cheat uses × 1.2 tolerance). */
    maxSpeed: z.number().min(1).max(12).default(6),
    items: z.array(z.string()).min(1),
    requiredItems: z.array(z.string()).default([]),
    homeTasks: z.array(z.string()),
    hazards: z.array(z.object({ key: z.string(), count: z.number().int().min(1).max(20) })),
    npcs: z.array(z.string()),
    announcements: z
      .array(z.object({ atSec: z.number().min(0), fil: z.string(), en: z.string() }))
      .default([]),
    stars: z
      .object({
        /** Share of max prep score needed for 2 stars. */
        twoStarPrepRatio: z.number().min(0).max(1).default(0.7),
      })
      .default({ twoStarPrepRatio: 0.7 }),
    scoring: z
      .object({
        timeBonusPerSec: z.number().default(5),
        nonEssentialPenaltyPerKg: z.number().default(20),
        wrongActionPenalty: z.number().default(50),
      })
      .default({ timeBonusPerSec: 5, nonEssentialPenaltyPerKg: 20, wrongActionPenalty: 50 }),
    actions: levelActionsSchema.default({ ...DEFAULT_ACTIONS }),
  })
  .strict();

export type LevelActions = z.infer<typeof levelActionsSchema>;

export type LevelConfig = z.infer<typeof levelConfigSchema>;
export type LevelMap = z.infer<typeof levelMapSchema>;
