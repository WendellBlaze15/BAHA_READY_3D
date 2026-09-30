import { DEFAULT_ACTIONS, type LevelActions } from '../level-config.ts';

/**
 * Energy-limited sprint + jump rules, shared by the client (feel) and the authoritative replay
 * (anti-cheat). Pure and deterministic: fixed 0.1 s sub-steps.
 *
 * - Sprint starts only with stamina ≥ sprintMinStartStamina and drains sprintDrainPerSec.
 * - Hitting 0 → exhausted ("Hingal"): no sprint until stamina regenerates to sprintResumeStamina.
 * - Jumps cost jumpStaminaCost (a jump that empties the bar also exhausts).
 */
export type SprintState = {
  stamina: number;
  /** Player is holding the sprint input. */
  want: boolean;
  /** Sprint is actually active (want + allowed). */
  sprinting: boolean;
  exhausted: boolean;
};

const STEP = 0.1;

export function initialSprintState(stamina = 100): SprintState {
  return { stamina, want: false, sprinting: false, exhausted: false };
}

export function withActions(a?: Partial<LevelActions>): LevelActions {
  return { ...DEFAULT_ACTIONS, ...a } as LevelActions;
}

/**
 * Advances `dt` seconds. Returns the new state and how many of those seconds were spent
 * sprinting (the replay grants sprint speed only for those seconds).
 * `extraDrainPerSec` lets the client add terrain drains (wading/swimming) on top.
 */
export function stepSprint(
  s: SprintState,
  dt: number,
  a: LevelActions,
  extraDrainPerSec = 0,
): { state: SprintState; sprintSeconds: number } {
  let { stamina, sprinting, exhausted } = s;
  const { want } = s;
  let sprintSeconds = 0;
  let rem = Math.max(0, dt);
  while (rem > 1e-9) {
    const h = Math.min(STEP, rem);
    rem -= h;
    if (sprinting && (!want || exhausted)) sprinting = false;
    if (!sprinting && want && !exhausted && stamina >= a.sprintMinStartStamina) sprinting = true;
    if (sprinting) {
      stamina -= (a.sprintDrainPerSec + extraDrainPerSec) * h;
      sprintSeconds += h;
    } else {
      stamina += (a.staminaRegenPerSec - extraDrainPerSec) * h;
    }
    if (stamina <= 0) {
      stamina = 0;
      exhausted = true;
      sprinting = false;
    }
    stamina = Math.min(100, stamina);
    if (exhausted && stamina >= a.sprintResumeStamina) exhausted = false;
  }
  return { state: { stamina, want, sprinting, exhausted }, sprintSeconds };
}

export function setSprintIntent(s: SprintState, want: boolean): SprintState {
  return { ...s, want, sprinting: want ? s.sprinting : false };
}

/** Returns the state after a jump, or null when the jump isn't allowed. */
export function tryJump(s: SprintState, a: LevelActions): SprintState | null {
  if (!a.jumpEnabled || s.exhausted) return null;
  const stamina = Math.max(0, s.stamina - a.jumpStaminaCost);
  const exhausted = stamina === 0;
  return { ...s, stamina, exhausted, sprinting: exhausted ? false : s.sprinting };
}
