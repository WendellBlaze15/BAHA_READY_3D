// AUTO-SYNCED from packages/shared/src by scripts/sync-functions-shared.mjs. Do not edit.
import { DEFAULT_ACTIONS, type LevelActions } from '../level-config.ts';

/**
 * Energy-limited sprint + jump rules, shared by the client (feel), the authoritative attempt
 * replay (Signal levels) and the Survival game server. Pure and deterministic: fixed 0.1 s steps.
 *
 * - Walking speed never depends on stamina (no slow-motion when tired).
 * - Sprint starts only with stamina ≥ sprintMinStartStamina and drains sprintDrainPerSec.
 * - Hitting 0 → exhausted ("Hingal"): sprint AND jump are locked until stamina refills to
 *   sprintResumeStamina; then everything works normally again.
 * - After sprinting/jumping, refill waits staminaRegenDelaySec, then runs at the walk or idle
 *   rate. Terrain drains (wading, currents) are passed in by the caller.
 */
export type SprintState = {
  stamina: number;
  /** Player is holding the sprint input. */
  want: boolean;
  /** Sprint is actually active (want + allowed). */
  sprinting: boolean;
  exhausted: boolean;
  /** Seconds left before refill starts. */
  regenDelay: number;
};

const STEP = 0.1;

export function initialSprintState(stamina = 100): SprintState {
  return { stamina, want: false, sprinting: false, exhausted: false, regenDelay: 0 };
}

export function withActions(a?: Partial<LevelActions>): LevelActions {
  return { ...DEFAULT_ACTIONS, ...a } as LevelActions;
}

export type StepOptions = {
  /**
   * Whether the player is moving (walk refill rate) or standing (idle rate). Omit in the
   * authoritative replay: it then assumes the faster rate, an upper bound on real stamina, so an
   * honest run can never be flagged.
   */
  moving?: boolean;
  /** Extra terrain drain (points/s), e.g. wading or currents. */
  extraDrainPerSec?: number;
};

/**
 * Advances `dt` seconds. Returns the new state, how many seconds were spent sprinting (the
 * replay grants sprint speed only for those) and how many were spent locked out ("Hingal").
 */
export function stepSprint(
  s: SprintState,
  dt: number,
  a: LevelActions,
  opts: StepOptions = {},
): { state: SprintState; sprintSeconds: number; lockedSeconds: number } {
  let { stamina, sprinting, exhausted, regenDelay } = s;
  const { want } = s;
  const extra = opts.extraDrainPerSec ?? 0;
  const regenRate =
    opts.moving === undefined
      ? Math.max(a.staminaRegenWalkPerSec, a.staminaRegenIdlePerSec)
      : opts.moving
        ? a.staminaRegenWalkPerSec
        : a.staminaRegenIdlePerSec;
  let sprintSeconds = 0;
  let lockedSeconds = 0;
  let rem = Math.max(0, dt);
  while (rem > 1e-9) {
    const h = Math.min(STEP, rem);
    rem -= h;
    if (sprinting && (!want || exhausted)) sprinting = false;
    if (!sprinting && want && !exhausted && stamina >= a.sprintMinStartStamina) sprinting = true;
    if (sprinting) {
      stamina -= (a.sprintDrainPerSec + extra) * h;
      sprintSeconds += h;
      regenDelay = a.staminaRegenDelaySec;
    } else if (regenDelay > 1e-9) {
      regenDelay = Math.max(0, regenDelay - h);
      stamina -= extra * h;
    } else {
      stamina += (regenRate - extra) * h;
    }
    if (stamina <= 0) {
      stamina = 0;
      if (!exhausted) regenDelay = a.staminaRegenDelaySec;
      exhausted = true;
      sprinting = false;
    }
    stamina = Math.min(100, stamina);
    if (exhausted && stamina >= a.sprintResumeStamina) exhausted = false;
    if (exhausted) lockedSeconds += h;
  }
  return {
    state: { stamina, want, sprinting, exhausted, regenDelay },
    sprintSeconds,
    lockedSeconds,
  };
}

export function setSprintIntent(s: SprintState, want: boolean): SprintState {
  return { ...s, want, sprinting: want ? s.sprinting : false };
}

/** Returns the state after a jump, or null when the jump isn't allowed (disabled / Hingal). */
export function tryJump(s: SprintState, a: LevelActions): SprintState | null {
  if (!a.jumpEnabled || s.exhausted) return null;
  const stamina = Math.max(0, s.stamina - a.jumpStaminaCost);
  const exhausted = stamina === 0;
  return {
    ...s,
    stamina,
    exhausted,
    sprinting: exhausted ? false : s.sprinting,
    regenDelay: a.staminaRegenDelaySec,
  };
}
