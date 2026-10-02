import {
  depthAt,
  depthBand,
  groundAt,
  inBounds,
  maxSpeedAt,
  type DepthBand,
  type SurvivalConfig,
  type SurvivalMap,
} from '@baha/shared/survival';
import type { LevelActions } from '@baha/shared/level-config';

/** Same jump physics the server's envelope is built from (apex ≈ 1.09 m). */
export const GRAVITY = 20;
export const JUMP_VELOCITY = 6.6;
/** Climbing a wall/roof edge (blocky-game style: walk into it to climb). */
export const CLIMB_SPEED = 3;
/** Stay a little under the server's speed limit (it allows ×1.2 + jitter; we use ×0.96). */
const SPEED_MARGIN = 0.96;
/** Swimmers float with the head above the surface. */
const SWIM_SINK = 0.9;

export interface CtrlState {
  x: number;
  y: number;
  z: number;
  vy: number;
  facing: number;
  grounded: boolean;
  climbing: boolean;
}

export interface CtrlEnv {
  map: SurvivalMap;
  waterLevel: number;
  actions: LevelActions;
  bag: SurvivalConfig['bag'];
  carryRatio: number;
  /** Sprint allowed right now (server stamina not Hingal, energy not out). */
  sprintAllowed: boolean;
  swimSpeedMul: number;
  /** Downed: crawl at a fraction of walk speed, no jumping/sprinting. */
  crawlMul: number | null;
}

export interface CtrlInput {
  /** World-space move direction (length ≤ 1). */
  mx: number;
  mz: number;
  sprint: boolean;
  jump: boolean;
}

export function floorAt(env: CtrlEnv, x: number, z: number) {
  const g = groundAt(env.map, x, z);
  const band = depthBand(depthAt(env.map, x, z, env.waterLevel));
  return { ground: band === 'swim' ? Math.max(g, env.waterLevel - SWIM_SINK) : g, band };
}

/**
 * One frame of local, server-compatible movement. Returns the next state, the horizontal speed
 * actually used (for animation) and whether a jump started (→ send action:jump).
 */
export function stepController(
  s: CtrlState,
  input: CtrlInput,
  dt: number,
  env: CtrlEnv,
): { s: CtrlState; speed: number; jumped: boolean; sprinting: boolean; band: DepthBand } {
  const here = floorAt(env, s.x, s.z);
  const len = Math.min(1, Math.hypot(input.mx, input.mz));
  const sprinting =
    !env.crawlMul &&
    input.sprint &&
    env.sprintAllowed &&
    len > 0.1 &&
    here.band !== 'waist' &&
    here.band !== 'swim';
  const actions = env.crawlMul
    ? { ...env.actions, walkSpeed: env.actions.walkSpeed * env.crawlMul }
    : env.actions;
  const vmax = maxSpeedAt(
    {
      map: env.map,
      waterLevel: env.waterLevel,
      actions,
      bag: env.bag,
      carryRatio: env.carryRatio,
      sprinting,
      onRaft: false,
      swimSpeedMul: env.swimSpeedMul,
    },
    here.band,
  );

  let { x, y, z, vy, facing, grounded, climbing } = s;
  // Climbing: walking into a higher surface lifts you up its face; little sideways motion.
  climbing = y < here.ground - 0.05;
  const horiz = vmax * SPEED_MARGIN * len * (climbing ? 0.15 : 1);
  let speed = 0;
  if (len > 0.01) {
    const nx = x + (input.mx / Math.max(len, 1e-6)) * horiz * dt;
    const nz = z + (input.mz / Math.max(len, 1e-6)) * horiz * dt;
    if (inBounds(env.map, nx, nz)) {
      // Sample the band at the destination too (entering deeper water slows you there).
      const there = floorAt(env, nx, nz);
      const vThere = maxSpeedAt(
        {
          map: env.map,
          waterLevel: env.waterLevel,
          actions,
          bag: env.bag,
          carryRatio: env.carryRatio,
          sprinting,
          onRaft: false,
          swimSpeedMul: env.swimSpeedMul,
        },
        there.band,
      );
      const k = Math.min(
        1,
        (vThere * SPEED_MARGIN * len * (climbing ? 0.15 : 1)) / Math.max(horiz, 1e-6),
      );
      x += (nx - x) * k;
      z += (nz - z) * k;
      speed = horiz * k;
    }
    facing = Math.atan2(input.mx, input.mz);
  }

  const floor = floorAt(env, x, z);
  let jumped = false;
  if (y < floor.ground - 0.05) {
    // Climb at a steady pace; never teleport up a wall.
    y = Math.min(floor.ground, y + CLIMB_SPEED * dt);
    vy = 0;
    grounded = y >= floor.ground - 0.05;
  } else {
    if (input.jump && grounded && !env.crawlMul && floor.band !== 'swim') {
      vy = JUMP_VELOCITY;
      grounded = false;
      jumped = true;
    }
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= floor.ground) {
      y = floor.ground;
      vy = 0;
      grounded = true;
    } else grounded = false;
  }
  return {
    s: { x, y, z, vy, facing, grounded, climbing },
    speed,
    jumped,
    sprinting,
    band: floor.band,
  };
}
