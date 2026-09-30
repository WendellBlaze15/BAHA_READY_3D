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

/** Straight line from the start at `speed` m/s, sampled every second. */
function dash(opts: {
  speed: number;
  seconds: number;
  t0?: number;
  sprint?: boolean;
  jumps?: number;
}) {
  const t0 = opts.t0 ?? 1;
  const ev: GameEvent[] = [
    { t: 0, type: 'phase', payload: { phase: 'prep' } },
    { t: t0, type: 'phase', payload: { phase: 'evac' } },
  ];
  for (let i = 0; i < (opts.jumps ?? 0); i++) ev.push({ t: t0, type: 'jump', payload: {} });
  if (opts.sprint) ev.push({ t: t0, type: 'sprint', payload: { on: true } });
  for (let s = 0; s <= opts.seconds; s++) {
    ev.push({
      t: t0 + s,
      type: 'pos',
      payload: { x: Math.round((layout.start.x + opts.speed * s) * 100) / 100, z: layout.start.z },
    });
  }
  if (opts.sprint) ev.push({ t: t0 + opts.seconds, type: 'sprint', payload: { on: false } });
  return ev;
}
const speedFlag = (ev: GameEvent[]) =>
  computeResult(config, content, layout, ev).flags.includes('SPEED_IMPOSSIBLE');

describe('sprint & jump (config defaults)', () => {
  it('old level configs get action defaults', () => {
    expect(config.actions).toEqual(withActions());
    expect(config.actions.sprintMultiplier).toBe(1.6);
  });

  it('allows sprint speed while stamina lasts', () => {
    expect(speedFlag(dash({ speed: 9.5, seconds: 5, sprint: true }))).toBe(false);
  });

  it('flags the same speed without a sprint', () => {
    expect(speedFlag(dash({ speed: 9.5, seconds: 5 }))).toBe(true);
  });

  it('flags sprinting past an empty stamina bar', () => {
    // 100 stamina / 12 per s ≈ 8.3 s of sprint.
    expect(speedFlag(dash({ speed: 9.5, seconds: 15, sprint: true }))).toBe(true);
  });

  it('jumps drain the stamina a sprint needs', () => {
    expect(speedFlag(dash({ speed: 9.5, seconds: 3, sprint: true, jumps: 25 }))).toBe(true);
  });

  it('normal walking is unaffected', () => {
    expect(speedFlag(dash({ speed: 5, seconds: 20 }))).toBe(false);
  });
});

describe('stamina rules', () => {
  it('drains while sprinting and locks out at zero until the resume threshold', () => {
    let s = setSprintIntent(initialSprintState(), true);
    let r = stepSprint(s, 5, A);
    expect(r.sprintSeconds).toBeCloseTo(5, 5);
    expect(r.state.stamina).toBeCloseTo(40, 5);
    r = stepSprint(r.state, 3.4, A); // 40 / 12 ≈ 3.33 s → empty → exhausted
    expect(r.state.exhausted).toBe(true);
    expect(r.state.sprinting).toBe(false);
    // Still holding sprint: regen until 25, then sprint resumes.
    s = r.state;
    r = stepSprint(s, 4, A); // +20 → 20, still exhausted
    expect(r.state.exhausted).toBe(true);
    expect(r.sprintSeconds).toBe(0);
    r = stepSprint(r.state, 2, A); // reaches 25 → unlocked → sprints again
    expect(r.state.exhausted).toBe(false);
    expect(r.sprintSeconds).toBeGreaterThan(0);
  });

  it('cannot start sprinting below the start threshold', () => {
    const s = setSprintIntent({ ...initialSprintState(5) }, true);
    expect(stepSprint(s, 0.1, A).sprintSeconds).toBe(0);
  });

  it('regenerates when not sprinting, capped at 100', () => {
    expect(stepSprint(initialSprintState(90), 10, A).state.stamina).toBe(100);
  });

  it('jump costs stamina and is refused when exhausted or disabled', () => {
    const j = tryJump(initialSprintState(), A)!;
    expect(j.stamina).toBe(96);
    expect(tryJump({ ...initialSprintState(0), exhausted: true }, A)).toBeNull();
    expect(tryJump(initialSprintState(), { ...A, jumpEnabled: false })).toBeNull();
    const last = tryJump(initialSprintState(3), A)!;
    expect(last.exhausted).toBe(true);
  });

  it('terrain drain is added on top while sprinting', () => {
    const s = setSprintIntent(initialSprintState(), true);
    expect(stepSprint(s, 1, A, 4).state.stamina).toBeCloseTo(84, 5);
  });
});
