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

/**
 * Movement actions (jump, energy-limited sprint). Defaults keep older level versions valid.
 * DECISION (owner): exhaustion never slows walking — the only effect of an empty stamina bar is
 * that sprint and jump are locked until stamina refills to sprintResumeStamina.
 */
export const DEFAULT_ACTIONS = {
  /** Normal walking speed on dry ground (m/s). Never reduced by low stamina. */
  walkSpeed: 4.6,
  sprintMultiplier: 1.6,
  sprintDrainPerSec: 12,
  /** Seconds after sprinting/jumping before stamina starts refilling. */
  staminaRegenDelaySec: 0.5,
  /** Refill rate while walking / while standing still (stamina points per second). */
  staminaRegenWalkPerSec: 20,
  staminaRegenIdlePerSec: 30,
  /** Sprint can't start below this stamina… */
  sprintMinStartStamina: 10,
  /** …and after running empty ("Hingal"), it stays locked until stamina recovers to this. */
  sprintResumeStamina: 25,
  jumpEnabled: true,
  jumpStaminaCost: 4,
} as const;

export const levelActionsSchema = z
  .object({
    walkSpeed: z.number().min(2).max(8).default(DEFAULT_ACTIONS.walkSpeed),
    sprintMultiplier: z.number().min(1).max(2.5).default(DEFAULT_ACTIONS.sprintMultiplier),
    sprintDrainPerSec: z.number().min(0).max(50).default(DEFAULT_ACTIONS.sprintDrainPerSec),
    staminaRegenDelaySec: z.number().min(0).max(5).default(DEFAULT_ACTIONS.staminaRegenDelaySec),
    staminaRegenWalkPerSec: z
      .number()
      .min(0)
      .max(100)
      .default(DEFAULT_ACTIONS.staminaRegenWalkPerSec),
    staminaRegenIdlePerSec: z
      .number()
      .min(0)
      .max(100)
      .default(DEFAULT_ACTIONS.staminaRegenIdlePerSec),
    /** @deprecated v2 configs stored a single regen rate; it is ignored (see the rates above). */
    staminaRegenPerSec: z.number().min(0).max(50).optional(),
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

/**
 * Third-person camera (presentation only — never scored). Angles in radians, distances in m.
 * Players adjust sensitivity / invert-Y / auto-follow in user_settings.controls.
 */
export const DEFAULT_CAMERA = {
  /** Starting framing indoors (prep, open-top house) and outdoors (evacuation). */
  indoorDistance: 11,
  indoorPitch: 0.82,
  outdoorDistance: 10,
  outdoorPitch: 0.55,
  minDistance: 4,
  maxDistance: 16,
  /** Pitch limits: never below the horizon, never straight down. */
  minPitch: 0.12,
  maxPitch: 1.25,
  /** Manual orbit pauses auto-follow for this long (and until the player moves). */
  followDelaySec: 1.5,
  /** Base auto-follow rate (1/s); scaled by the player's follow-speed preference. */
  followRate: 3,
  /** Pull-in distance kept between the camera and a blocking wall. */
  collisionPadding: 0.3,
  /** Closest the camera may be pulled in by walls. */
  collisionMinDistance: 1.2,
} as const;

export const cameraConfigSchema = z
  .object({
    indoorDistance: z.number().min(2).max(30).default(DEFAULT_CAMERA.indoorDistance),
    indoorPitch: z.number().min(0).max(1.5).default(DEFAULT_CAMERA.indoorPitch),
    outdoorDistance: z.number().min(2).max(30).default(DEFAULT_CAMERA.outdoorDistance),
    outdoorPitch: z.number().min(0).max(1.5).default(DEFAULT_CAMERA.outdoorPitch),
    minDistance: z.number().min(1).max(30).default(DEFAULT_CAMERA.minDistance),
    maxDistance: z.number().min(2).max(40).default(DEFAULT_CAMERA.maxDistance),
    minPitch: z.number().min(0).max(1.5).default(DEFAULT_CAMERA.minPitch),
    maxPitch: z.number().min(0.1).max(1.55).default(DEFAULT_CAMERA.maxPitch),
    followDelaySec: z.number().min(0).max(10).default(DEFAULT_CAMERA.followDelaySec),
    followRate: z.number().min(0.1).max(20).default(DEFAULT_CAMERA.followRate),
    collisionPadding: z.number().min(0).max(2).default(DEFAULT_CAMERA.collisionPadding),
    collisionMinDistance: z.number().min(0.5).max(10).default(DEFAULT_CAMERA.collisionMinDistance),
  })
  .strict();

export type CameraConfig = z.infer<typeof cameraConfigSchema>;

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
    camera: cameraConfigSchema.default({ ...DEFAULT_CAMERA }),
  })
  .strict();

export type LevelActions = z.infer<typeof levelActionsSchema>;

export type LevelConfig = z.infer<typeof levelConfigSchema>;
export type LevelMap = z.infer<typeof levelMapSchema>;
