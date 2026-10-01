import type { LevelActions } from '../level-config.ts';
import type { SurvivalConfig } from './config.ts';
import {
  DEPTH_SPEED,
  depthAt,
  depthBand,
  groundAt,
  inBounds,
  type DepthBand,
} from './map/query.ts';
import type { SurvivalMap } from './map/types.ts';

/**
 * Authoritative movement validation for the Survival game server (Section 18.3). The client
 * predicts with Rapier and sends samples at ~15 Hz; the server checks each step and sends a
 * correction when it is impossible.
 *
 * Owner rules: walking speed never depends on stamina/energy; sprint speed is allowed only while
 * the SERVER's own stamina state says the player is sprinting; jumps have a fixed envelope.
 */
export const MOVE_TOLERANCE = 1.2;
/** Per-sample jitter allowance (m): network/frame noise, forgiven once per sample. */
export const MOVE_JITTER_M = 0.5;
/** Jump apex from GRAVITY 20 m/s² and 6.6 m/s take-off ≈ 1.09 m. */
export const JUMP_APEX_M = 1.1;
export const RAFT_SPEED_MUL = 1.5;

export type MoveSample = { x: number; y: number; z: number; t: number };

export type MoveContext = {
  map: SurvivalMap;
  waterLevel: number;
  actions: LevelActions;
  bag: SurvivalConfig['bag'];
  /** Current carried weight / max weight. */
  carryRatio: number;
  /** Server-side stamina state: true only while sprint is genuinely active. */
  sprinting: boolean;
  onRaft: boolean;
  /** Role perk (Scout ×1.2; solo gets half strength). */
  swimSpeedMul: number;
};

export type MoveVerdict =
  | { ok: true; band: DepthBand }
  | {
      ok: false;
      reason: 'out_of_bounds' | 'too_fast' | 'flying' | 'too_heavy_to_swim';
      band: DepthBand;
    };

/** Maximum horizontal speed (m/s) at a position, before tolerance. */
export function maxSpeedAt(ctx: MoveContext, band: DepthBand) {
  let v = ctx.actions.walkSpeed * DEPTH_SPEED[band];
  if (band === 'swim') v *= ctx.swimSpeedMul;
  if (ctx.onRaft && band === 'swim') v = ctx.actions.walkSpeed * RAFT_SPEED_MUL;
  // Sprint never applies in deep water (same as the Signal levels).
  if (ctx.sprinting && band !== 'waist' && band !== 'swim') v *= ctx.actions.sprintMultiplier;
  // Over-weight is a lesson modifier (pack light) and stays.
  if (ctx.carryRatio > ctx.bag.slowAtRatio) v *= ctx.bag.slowMultiplier;
  return v;
}

export function validateMove(prev: MoveSample, next: MoveSample, ctx: MoveContext): MoveVerdict {
  const nextDepth = depthAt(ctx.map, next.x, next.z, ctx.waterLevel);
  const band = depthBand(nextDepth);
  if (!inBounds(ctx.map, next.x, next.z)) return { ok: false, reason: 'out_of_bounds', band };
  if (band === 'swim' && !ctx.onRaft && ctx.carryRatio > 1)
    return { ok: false, reason: 'too_heavy_to_swim', band };

  // Use the more permissive band of the two ends so transitions (e.g. climbing out of the
  // water onto a roof) are never flagged.
  const prevBand = depthBand(depthAt(ctx.map, prev.x, prev.z, ctx.waterLevel));
  const vmax = Math.max(maxSpeedAt(ctx, band), maxSpeedAt(ctx, prevBand));
  const dt = Math.max(0, next.t - prev.t);
  const d = Math.hypot(next.x - prev.x, next.z - prev.z);
  if (d > vmax * MOVE_TOLERANCE * dt + MOVE_JITTER_M)
    return { ok: false, reason: 'too_fast', band };

  // Vertical envelope: never above ground + jump apex (with slack); swimmers float at the surface.
  const ground = Math.max(groundAt(ctx.map, next.x, next.z), groundAt(ctx.map, prev.x, prev.z));
  const floor = Math.max(ground, band === 'swim' ? ctx.waterLevel : ground);
  if (next.y > floor + JUMP_APEX_M * 1.3 + 0.3) return { ok: false, reason: 'flying', band };

  return { ok: true, band };
}
