import { describe, expect, it } from 'vitest';
import { levelConfigSchema, type LevelConfig } from '../level-config.ts';
import type { GameContent } from './content.ts';
import type { GameEvent } from './events.ts';
import { generateLayout } from './layout.ts';
import { computeResult } from './scoring.ts';
import {
  initialSprintState,
  setSprintIntent,
  stepSprint,
  tryJump,
  withActions,
} from './stamina.ts';

const config: LevelConfig = levelConfigSchema.parse({
  signal: 1,
  map: 'street',
  prepTimeSec: 90,
  evacTimeSec: 120,
  minDurationSec: 5,
  weightLimitKg: 8,
  waterRiseSpeed: 0.01,
  rainIntensity: 0.5,
  currentStrength: 0.2,
  night: false,
  lightning: false,
  maxSpeed: 6,
  items: ['drinking_water'],
  homeTasks: [],
  hazards: [],
  npcs: [],
});
const content: GameContent = { items: [], tasks: [], hazards: [], npcs: [] };
const layout = generateLayout(config, 42n);
const A = withActions(config.actions);

type Leg = { speed: number; seconds: number; sprint?: boolean };
/** Straight run from the start in legs (0.5 s position samples, like the client). */
function run(legs: Leg[], opts: { jumps?: number } = {}) {
  const t0 = 1;
  const ev: GameEvent[] = [
    { t: 0, type: 'phase', payload: { phase: 'prep' } },
    { t: t0, type: 'phase', payload: { phase: 'evac' } },
  ];
  for (let i = 0; i < (opts.jumps ?? 0); i++) ev.push({ t: t0, type: 'jump', payload: {} });
  let t = t0;
  let x = layout.start.x;
  let sprinting = false;
  ev.push({ t, type: 'pos', payload: { x, z: layout.start.z } });
  for (const leg of legs) {
    if (!!leg.sprint !== sprinting) {
      sprinting = !!leg.sprint;
      ev.push({ t, type: 'sprint', payload: { on: sprinting } });
    }
    for (let s = 0; s < leg.seconds * 2; s++) {
      t = Math.round((t + 0.5) * 100) / 100;
      x += leg.speed * 0.5;
      ev.push({ t, type: 'pos', payload: { x: Math.round(x * 100) / 100, z: layout.start.z } });
    }
  }
  return ev;
}
const flagged = (ev: GameEvent[]) =>
  computeResult(config, content, layout, ev).flags.includes('SPEED_IMPOSSIBLE');

describe('config defaults', () => {
  it('older level configs get the new action defaults', () => {
    expect(config.actions).toMatchObject({
      sprintMultiplier: 1.6,
      sprintDrainPerSec: 12,
      staminaRegenDelaySec: 0.5,
      staminaRegenWalkPerSec: 20,
      staminaRegenIdlePerSec: 30,
      sprintResumeStamina: 25,
    });
  });

  it('v2 configs with the deprecated single regen rate still validate', () => {
    const v2 = levelConfigSchema.parse({ ...config, actions: { staminaRegenPerSec: 5 } });
    expect(v2.actions.staminaRegenWalkPerSec).toBe(20);
  });
});

describe('replay anti-cheat', () => {
  it('accepts sprint speed while stamina lasts', () => {
    expect(flagged(run([{ speed: 9.5, seconds: 5, sprint: true }]))).toBe(false);
  });

  it('flags the same speed without a sprint', () => {
    expect(flagged(run([{ speed: 9.5, seconds: 5 }]))).toBe(true);
  });

  it('walking at base speed with 0 stamina is valid (no slow-motion)', () => {
    // Sprint the bar empty, then keep walking (holding sprint or not): never flagged.
    const empty: Leg = { speed: 7.3, seconds: 9, sprint: true };
    expect(flagged(run([empty, { speed: 5.5, seconds: 20, sprint: true }]))).toBe(false);
    expect(flagged(run([empty, { speed: 5.5, seconds: 20 }]))).toBe(false);
  });

  it('flags sprint speed while sprint is locked out', () => {
    // 100 / 12 ≈ 8.3 s of sprint, then Hingal; keeping 9.5 m/s through the lockout is a cheat.
    expect(flagged(run([{ speed: 9.5, seconds: 12, sprint: true }]))).toBe(true);
  });

  it('flags sprinting right after jumps emptied the bar', () => {
    expect(flagged(run([{ speed: 9.5, seconds: 3, sprint: true }], { jumps: 25 }))).toBe(true);
  });

  it('honest sprint → lockout → walk → sprint again is valid', () => {
    expect(
      flagged(
        run([
          { speed: 7.3, seconds: 8, sprint: true },
          { speed: 4.6, seconds: 3 },
          { speed: 7.3, seconds: 2, sprint: true },
          { speed: 4.6, seconds: 5 },
        ]),
      ),
    ).toBe(false);
  });

  it('normal walking is unaffected', () => {
    expect(flagged(run([{ speed: 5, seconds: 20 }]))).toBe(false);
  });
});

describe('stamina rules', () => {
  it('drains while sprinting and locks out at zero', () => {
    const s = setSprintIntent(initialSprintState(), true);
    let r = stepSprint(s, 5, A, { moving: true });
    expect(r.sprintSeconds).toBeCloseTo(5, 5);
    expect(r.state.stamina).toBeCloseTo(40, 5);
    r = stepSprint(r.state, 3.4, A, { moving: true }); // 40 / 12 ≈ 3.33 s → empty
    expect(r.state.exhausted).toBe(true);
    expect(r.state.sprinting).toBe(false);
  });

  it('waits the regen delay, then refills at the walk rate and unlocks at 25', () => {
    let s = {
      ...initialSprintState(0),
      exhausted: true,
      regenDelay: A.staminaRegenDelaySec,
    };
    let r = stepSprint(s, 0.5, A, { moving: true });
    expect(r.state.stamina).toBe(0); // still in the delay
    r = stepSprint(r.state, 1, A, { moving: true }); // +20
    expect(r.state.stamina).toBeCloseTo(20, 5);
    expect(r.state.exhausted).toBe(true);
    r = stepSprint(r.state, 0.3, A, { moving: true }); // → 26 ≥ 25
    expect(r.state.exhausted).toBe(false);
    // Holding sprint again works normally after the reset.
    s = setSprintIntent(r.state, true);
    expect(stepSprint(s, 0.5, A, { moving: true }).sprintSeconds).toBeGreaterThan(0);
  });

  it('refills faster while standing still', () => {
    const s = initialSprintState(0);
    expect(stepSprint(s, 1, A, { moving: false }).state.stamina).toBeCloseTo(30, 5);
    expect(stepSprint(s, 1, A, { moving: true }).state.stamina).toBeCloseTo(20, 5);
  });

  it('the replay assumes the faster (idle) rate as an upper bound', () => {
    expect(stepSprint(initialSprintState(0), 1, A).state.stamina).toBeCloseTo(30, 5);
  });

  it('cannot start sprinting below the start threshold', () => {
    const s = setSprintIntent(initialSprintState(5), true);
    expect(stepSprint(s, 0.1, A, { moving: true }).sprintSeconds).toBe(0);
  });

  it('caps at 100', () => {
    expect(stepSprint(initialSprintState(90), 10, A).state.stamina).toBe(100);
  });

  it('jump costs stamina, restarts the regen delay, and is refused during Hingal', () => {
    const j = tryJump(initialSprintState(), A)!;
    expect(j.stamina).toBe(96);
    expect(j.regenDelay).toBe(A.staminaRegenDelaySec);
    expect(tryJump({ ...initialSprintState(0), exhausted: true }, A)).toBeNull();
    expect(tryJump(initialSprintState(), { ...A, jumpEnabled: false })).toBeNull();
    expect(tryJump(initialSprintState(3), A)!.exhausted).toBe(true);
  });

  it('terrain drain applies on top while sprinting', () => {
    const s = setSprintIntent(initialSprintState(), true);
    const r = stepSprint(s, 1, A, { moving: true, extraDrainPerSec: 4 });
    expect(r.state.stamina).toBeCloseTo(84, 5);
  });

  it('reports seconds spent locked out', () => {
    const s = { ...initialSprintState(0), exhausted: true, regenDelay: 0.5 };
    const r = stepSprint(s, 2, A, { moving: false }); // 0.5 delay + 25/30 ≈ 1.33 s
    expect(r.lockedSeconds).toBeGreaterThan(1.2);
    expect(r.lockedSeconds).toBeLessThan(1.5);
  });
});
