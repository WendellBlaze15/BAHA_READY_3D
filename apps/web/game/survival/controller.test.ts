import { describe, expect, it } from 'vitest';
import {
  BARANGAY_1,
  DEFAULT_SURVIVAL_CONFIG,
  groundAt,
  validateMove,
  type MoveSample,
} from '@baha/shared/survival';
import { stepController, type CtrlEnv, type CtrlState } from './controller';

const env = (over: Partial<CtrlEnv> = {}): CtrlEnv => ({
  map: BARANGAY_1,
  waterLevel: BARANGAY_1.baseWaterLevel,
  actions: DEFAULT_SURVIVAL_CONFIG.actions,
  bag: DEFAULT_SURVIVAL_CONFIG.bag,
  carryRatio: 0.2,
  sprintAllowed: true,
  swimSpeedMul: 1,
  crawlMul: null,
  ...over,
});

const at = (x: number, z: number): CtrlState => ({
  x,
  y: groundAt(BARANGAY_1, x, z),
  z,
  vy: 0,
  facing: 0,
  grounded: true,
  climbing: false,
});

/** Drives the controller and checks every 15 Hz sample against the server validator. */
function runAndValidate(
  start: CtrlState,
  dir: [number, number],
  seconds: number,
  sprint: boolean,
  e = env(),
) {
  let s = start;
  let last: MoveSample = { x: s.x, y: s.y, z: s.z, t: 0 };
  let violations = 0;
  let support = { y: s.y, t: 0 };
  const dt = 1 / 60;
  for (let i = 1; i <= Math.round(seconds * 60); i++) {
    s = stepController(s, { mx: dir[0], mz: dir[1], sprint, jump: i % 90 === 0 }, dt, e).s;
    if (i % 4 === 0) {
      const next = { x: s.x, y: s.y, z: s.z, t: i * dt };
      const v = validateMove(last, next, {
        map: e.map,
        waterLevel: e.waterLevel,
        actions: e.actions,
        bag: e.bag,
        carryRatio: e.carryRatio,
        sprinting: sprint,
        onRaft: false,
        swimSpeedMul: e.swimSpeedMul,
        supportY: next.t - support.t <= 1.2 ? support.y : undefined,
      });
      if (!v.ok) violations++;
      if (s.grounded) support = { y: groundAt(e.map, s.x, s.z), t: next.t };
      last = next;
    }
  }
  return { s, violations };
}

describe('client controller stays within server validation', () => {
  it('walking, sprinting, jumping across roofs and water never gets corrected', () => {
    expect(runAndValidate(at(-10, -2), [1, 0], 8, false).violations).toBe(0);
    expect(runAndValidate(at(-10, -2), [1, 0], 8, true).violations).toBe(0);
    expect(runAndValidate(at(0, -20), [0, -1], 10, true).violations).toBe(0); // into the market water
  });

  it('climbs onto a roof gradually instead of teleporting', () => {
    let s = at(-20, 0); // street, waist-deep
    const e = env();
    const ys: number[] = [];
    for (let i = 0; i < 240; i++) {
      s = stepController(s, { mx: 1, mz: 0, sprint: false, jump: false }, 1 / 60, e).s;
      ys.push(s.y);
    }
    const jumps = ys.slice(1).map((y, i) => y - ys[i]!);
    expect(Math.max(...jumps)).toBeLessThan(0.1);
  });

  it('downed players crawl slowly and cannot jump', () => {
    const r = stepController(
      at(-6, -2),
      { mx: 1, mz: 0, sprint: true, jump: true },
      1 / 60,
      env({ crawlMul: 0.3 }),
    );
    expect(r.jumped).toBe(false);
    expect(r.sprinting).toBe(false);
    expect(r.speed).toBeLessThan(DEFAULT_SURVIVAL_CONFIG.actions.walkSpeed * 0.31);
  });
});
