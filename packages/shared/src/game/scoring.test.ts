import { describe, expect, it } from 'vitest';
import { levelConfigSchema, type LevelConfig } from '../level-config.ts';
import type { GameContent } from './content.ts';
import type { GameEvent } from './events.ts';
import { applyDailyModifiers, dist, generateLayout, type Layout, type Vec2 } from './layout.ts';
import { computeResult } from './scoring.ts';
import { createRng } from './rng.ts';

const ESSENTIALS = ['drinking_water', 'ready_food', 'flashlight', 'first_aid_kit'];

const config: LevelConfig = levelConfigSchema.parse({
  signal: 3,
  map: 'palengke',
  prepTimeSec: 90,
  evacTimeSec: 140,
  minDurationSec: 20,
  weightLimitKg: 9,
  waterRiseSpeed: 0.008,
  rainIntensity: 0.6,
  currentStrength: 0.4,
  night: false,
  lightning: false,
  maxSpeed: 6,
  items: [...ESSENTIALS, 'television', 'candles', 'pet_carrier'],
  requiredItems: [],
  homeTasks: ['switch_off_breaker', 'charge_devices'],
  hazards: [
    { key: 'live_wire', count: 1 },
    { key: 'open_manhole', count: 2 },
    { key: 'debris', count: 2 },
  ],
  npcs: ['child', 'elderly'],
});

const content: GameContent = {
  items: [
    { key: 'drinking_water', weight_kg: 2, category: 'water', is_essential: true, points: 120 },
    { key: 'ready_food', weight_kg: 1.5, category: 'food', is_essential: true, points: 100 },
    { key: 'flashlight', weight_kg: 0.4, category: 'light', is_essential: true, points: 100 },
    { key: 'first_aid_kit', weight_kg: 0.6, category: 'health', is_essential: true, points: 100 },
    {
      key: 'television',
      weight_kg: 8,
      category: 'non_essential',
      is_essential: false,
      points: -100,
    },
    { key: 'candles', weight_kg: 0.4, category: 'non_essential', is_essential: false, points: -30 },
    { key: 'pet_carrier', weight_kg: 1, category: 'pet', is_essential: false, points: 40 },
  ],
  tasks: [
    { key: 'switch_off_breaker', points: 150 },
    { key: 'charge_devices', points: 80 },
  ],
  hazards: [
    { key: 'live_wire', penalty: 1000, instant_fail: true },
    { key: 'open_manhole', penalty: 300, instant_fail: false },
    { key: 'debris', penalty: 100, instant_fail: false },
  ],
  npcs: [
    { key: 'child', points: 300, needs: {} },
    { key: 'elderly', points: 300, needs: {} },
  ],
};

const SEED = 123456789n;

/** Simulates a player walking the route at `speed` m/s, sampling position every 0.5s. */
function walk(layout: Layout, opts: { speed?: number; detourTo?: Vec2[]; t0: number }) {
  const events: GameEvent[] = [];
  const waypoints = [layout.start, ...(opts.detourTo ?? []), ...layout.route.slice(1)];
  let t = opts.t0;
  let pos = { ...layout.start };
  const speed = opts.speed ?? 4;
  events.push({ t, type: 'pos', payload: { x: pos.x, z: pos.z } });
  for (const target of waypoints) {
    while (dist(pos, target) > 0.01) {
      const step = Math.min(speed * 0.5, dist(pos, target));
      const d = dist(pos, target);
      pos = {
        x: pos.x + ((target.x - pos.x) / d) * step,
        z: pos.z + ((target.z - pos.z) / d) * step,
      };
      t += 0.5;
      events.push({
        t: Math.round(t * 100) / 100,
        type: 'pos',
        payload: { x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100 },
      });
    }
  }
  return { events, t };
}

function perfectRun(layout: Layout) {
  const ev: GameEvent[] = [
    { t: 0, type: 'phase', payload: { phase: 'prep' } },
    ...ESSENTIALS.map((item, i) => ({ t: 2 + i, type: 'item_packed' as const, payload: { item } })),
    { t: 8, type: 'task_done', payload: { task: 'switch_off_breaker' } },
    { t: 10, type: 'task_done', payload: { task: 'charge_devices' } },
    { t: 12, type: 'phase', payload: { phase: 'evac' } },
  ];
  // Visit each NPC, then walk the route; NPCs follow.
  const npcVisits = layout.npcs.map((n) => n.pos);
  const w = walk(layout, { t0: 12, detourTo: npcVisits });
  const posEvents = w.events;
  const followEvents: GameEvent[] = layout.npcs.map((n) => {
    const s = posEvents.find(
      (e) => e.type === 'pos' && dist({ x: e.payload.x, z: e.payload.z }, n.pos) < 1,
    )!;
    return { t: s.t, type: 'npc_follow', payload: { id: n.id } };
  });
  const end = w.t;
  const tail: GameEvent[] = [
    ...layout.npcs.map((n) => ({ t: end, type: 'npc_rescued' as const, payload: { id: n.id } })),
    { t: end, type: 'evac_reached', payload: {} },
    { t: end, type: 'phase', payload: { phase: 'end' } },
  ];
  return [...ev, ...[...posEvents, ...followEvents].sort((a, b) => a.t - b.t), ...tail];
}

describe('layout', () => {
  it('is deterministic for the same seed', () => {
    expect(generateLayout(config, SEED)).toEqual(generateLayout(config, SEED));
  });
  it('differs for different seeds', () => {
    expect(generateLayout(config, 1).hazards).not.toEqual(generateLayout(config, 2).hazards);
  });
  it('places every configured hazard and NPC away from start and evac', () => {
    const l = generateLayout(config, SEED);
    expect(l.hazards).toHaveLength(5);
    expect(l.npcs).toHaveLength(2);
    for (const h of l.hazards) {
      expect(dist(h.pos, { x: 0, z: 0 })).toBeGreaterThanOrEqual(10);
      expect(dist(h.pos, l.evac.center)).toBeGreaterThanOrEqual(9);
    }
  });
  it('supports string seeds and a seeded rng helper', () => {
    const r = createRng('abc');
    const v = r.int(1, 3);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(3);
  });
  it('applies daily modifiers', () => {
    const c = applyDailyModifiers(config, { rainBoost: 0.2, waterRiseBoost: 0.5, night: true });
    expect(c.rainIntensity).toBeCloseTo(0.8);
    expect(c.waterRiseSpeed).toBeCloseTo(0.012);
    expect(c.night).toBe(true);
    expect(applyDailyModifiers(config, null)).toBe(config);
  });
});

describe('computeResult', () => {
  const layout = generateLayout(config, SEED);

  it('awards 3 stars for a perfect, plausible run', () => {
    const r = computeResult(config, content, layout, perfectRun(layout));
    expect(r.flags).toEqual([]);
    expect(r.outcome).toBe('completed');
    expect(r.stars).toBe(3);
    expect(r.npcsRescued).toBe(2);
    expect(r.breakdown.essentials).toBe(420);
    expect(r.breakdown.tasks).toBe(230);
    expect(r.breakdown.npcs).toBe(600);
    expect(r.score).toBe(Object.values(r.breakdown).reduce((a, b) => a + b, 0));
    expect(r.mistakes).toEqual([]);
  });

  it('penalizes non-essential weight and records mistakes', () => {
    const ev = perfectRun(layout);
    ev.splice(1, 0, { t: 1, type: 'item_packed', payload: { item: 'candles' } });
    const r = computeResult(config, content, layout, ev);
    expect(r.breakdown.nonEssentialItems).toBe(-30);
    expect(r.breakdown.nonEssentialWeightPenalty).toBe(-8);
    expect(r.mistakes).toContain('packed_candles');
  });

  it('respects unpacking', () => {
    const ev = perfectRun(layout);
    ev.splice(
      1,
      0,
      { t: 1, type: 'item_packed', payload: { item: 'candles' } },
      { t: 1.5, type: 'item_unpacked', payload: { item: 'candles' } },
    );
    expect(computeResult(config, content, layout, ev).packed).not.toContain('candles');
  });

  it('flags impossible speed (teleport)', () => {
    const ev = perfectRun(layout);
    const i = ev.findIndex((e) => e.type === 'pos' && e.t > 20);
    ev.splice(i, 0, { t: (ev[i - 1] as GameEvent).t, type: 'pos', payload: { x: 200, z: -300 } });
    expect(computeResult(config, content, layout, ev).flags).toContain('SPEED_IMPOSSIBLE');
  });

  it('flags a too-short attempt and out-of-order events', () => {
    const ev: GameEvent[] = [
      { t: 5, type: 'phase', payload: { phase: 'prep' } },
      { t: 1, type: 'phase', payload: { phase: 'evac' } },
      { t: 2, type: 'evac_reached', payload: {} },
    ];
    const r = computeResult(config, content, layout, ev);
    expect(r.flags).toEqual(
      expect.arrayContaining(['DURATION_TOO_SHORT', 'EVENT_ORDER_INVALID', 'EVAC_INVALID']),
    );
  });

  it('flags unknown items, overweight bags and unknown tasks', () => {
    const ev = perfectRun(layout);
    ev.splice(
      1,
      0,
      { t: 1, type: 'item_packed', payload: { item: 'gold_bar' } },
      { t: 1, type: 'item_packed', payload: { item: 'television' } },
      { t: 1, type: 'task_done', payload: { task: 'dance' } },
    );
    const r = computeResult(config, content, layout, ev);
    expect(r.flags).toEqual(expect.arrayContaining(['ITEM_UNKNOWN', 'OVERWEIGHT', 'TASK_UNKNOWN']));
  });

  it('flags hazard hits that do not match the seeded layout', () => {
    const ev = perfectRun(layout);
    ev.push({ t: 30, type: 'hazard_hit', payload: { id: 'debris-99', key: 'debris' } });
    expect(computeResult(config, content, layout, ev).flags).toContain('HAZARD_INVALID');
  });

  it('flags NPC rescue without following first', () => {
    const ev = perfectRun(layout).filter((e) => e.type !== 'npc_follow');
    expect(computeResult(config, content, layout, ev).flags).toContain('NPC_RESCUE_INVALID');
  });

  it('fails instantly on a live wire and halves the score', () => {
    const wire = layout.hazards.find((h) => h.key === 'live_wire')!;
    const ev = perfectRun(layout).filter((e) => e.type !== 'evac_reached');
    const i = ev.findIndex((e) => e.type === 'phase' && e.payload.phase === 'evac');
    const t = (ev[i] as GameEvent).t + 1;
    ev.splice(
      i + 1,
      0,
      { t, type: 'pos', payload: { x: wire.pos.x, z: wire.pos.z } },
      { t, type: 'hazard_hit', payload: { id: wire.id, key: 'live_wire' } },
    );
    // Keep positions plausible by starting at the wire: drop the speed check noise.
    const r = computeResult(config, content, layout, ev);
    expect(r.outcome).toBe('failed');
    expect(r.failReason).toBe('instant_fail');
    expect(r.stars).toBe(0);
    expect(r.mistakes).toContain('live_wire');
  });

  it('counts each hazard once and fails when damage is fatal', () => {
    const manholes = layout.hazards.filter((h) => h.key === 'open_manhole' || h.key === 'debris');
    const ev: GameEvent[] = [
      { t: 0, type: 'phase', payload: { phase: 'prep' } },
      { t: 30, type: 'phase', payload: { phase: 'evac' } },
    ];
    let t = 30;
    for (const h of manholes) {
      t += 0.5;
      ev.push({ t, type: 'pos', payload: { x: h.pos.x, z: h.pos.z } });
      ev.push({ t, type: 'hazard_hit', payload: { id: h.id, key: h.key } });
      ev.push({ t, type: 'hazard_hit', payload: { id: h.id, key: h.key } });
    }
    const r = computeResult(config, content, layout, ev);
    expect(r.hazardHits).toBe(manholes.length);
    expect(r.failReason).toBe('health');
  });

  it('times out when the evacuation center is never reached', () => {
    const ev = perfectRun(layout).filter(
      (e) => e.type !== 'evac_reached' && e.type !== 'npc_rescued',
    );
    const r = computeResult(config, content, layout, ev);
    expect(r.failReason).toBe('timeout');
    expect(r.wrongActions).toBe(2); // NPCs that followed were abandoned
    expect(r.feedback.some((f) => f.key === 'timeout')).toBe(true);
  });

  it('gives 1 star when surviving with a poor go-bag, 2 with a good one', () => {
    const base = perfectRun(layout).filter(
      (e) => e.type !== 'item_packed' && e.type !== 'task_done',
    );
    expect(computeResult(config, content, layout, base).stars).toBe(1);
    const good = perfectRun(layout).filter((e) => !(e.type === 'npc_rescued'));
    expect(computeResult(config, content, layout, good).stars).toBe(2);
  });

  it('requires required items (e.g. flashlight at night) for any star', () => {
    const cfg = { ...config, requiredItems: ['flashlight'] };
    const ev = perfectRun(layout).filter(
      (e) => !(e.type === 'item_packed' && e.payload.item === 'flashlight'),
    );
    const r = computeResult(cfg, content, layout, ev);
    expect(r.stars).toBe(0);
    expect(r.feedback).toContainEqual({ kind: 'danger', ref: 'item', key: 'flashlight' });
  });

  it('marks quit attempts as failed', () => {
    const ev = [
      ...perfectRun(layout).filter((e) => e.type !== 'evac_reached'),
      { t: 999, type: 'quit', payload: {} } as GameEvent,
    ];
    expect(computeResult(config, content, layout, ev).failReason).toBe('quit');
  });
});
