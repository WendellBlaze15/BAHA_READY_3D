import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVIVAL_CONFIG,
  DEPTH_SPEED,
  countItem,
  depthAt,
  depthBand,
  groundAt,
  survivalConfigSchema,
  type ClientMessage,
} from '@baha/shared/survival';
import { Simulation } from '../src/sim/simulation.ts';

const config = survivalConfigSchema.parse(DEFAULT_SURVIVAL_CONFIG);
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeSim(opts: { solo?: boolean; seed?: number; players?: number } = {}) {
  const n = opts.players ?? 2;
  const players = [A, B].slice(0, n).map((userId, i) => ({
    userId,
    username: `p${i}`,
    role: opts.solo ? 'solo' : i === 0 ? 'medic' : 'builder',
  }));
  return new Simulation({
    config,
    difficulty: 'normal',
    seed: opts.seed ?? 1234,
    solo: !!opts.solo,
    players,
  });
}

/** Teleports a player (test setup only) and resets its movement baseline. */
function place(sim: Simulation, uid: string, x: number, z: number) {
  const p = sim.players.get(uid)!;
  p.x = x;
  p.z = z;
  p.y = groundAt(sim.map, x, z);
  p.last = { x, y: p.y, z, t: null, at: sim.time };
  p.minOffset = null;
  return p;
}

function give(sim: Simulation, uid: string, item: string, qty: number) {
  const p = sim.players.get(uid)!;
  const slot = p.bag.findIndex((s) => s === null);
  const def = sim.items.get(item)!;
  p.bag[slot] = { item, qty, ...(def.durability ? { durability: def.durability } : {}) };
  return slot;
}

const moveMsg = (
  x: number,
  y: number,
  z: number,
  t: number,
  extra: Partial<ClientMessage<'move'>> = {},
): ClientMessage<'move'> => ({
  x,
  y,
  z,
  vx: 0,
  vz: 0,
  rotY: 0,
  anim: 'walk',
  sprinting: false,
  grounded: true,
  t,
  ...extra,
});

const types = (sim: Simulation) => sim.drainOut().map((o) => o.type);

/** Ticks `seconds` of simulation in 50 ms steps. */
function run(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) sim.tick(0.05);
}

describe('time, weather and stats', () => {
  it('advances the clock by difficulty and announces dawn', () => {
    const sim = makeSim();
    const start = sim.clock.minute;
    run(sim, 10);
    // Normal: 8 real minutes per in-game day → 3 in-game minutes per second.
    expect(sim.clock.minute - start).toBeCloseTo(30, 0);
    sim.clock = { day: 1, minute: 4 * 60 + 58 };
    sim.drainOut();
    run(sim, 2);
    expect(sim.drainOut().some((o) => o.type === 'event' && o.payload.kind === 'dawn')).toBe(true);
  });

  it('drains hunger/thirst over time; walking never depends on Lakas', () => {
    const sim = makeSim();
    run(sim, 60);
    const p = sim.players.get(A)!;
    expect(p.stats.hunger).toBeLessThan(100);
    expect(p.stats.thirst).toBeLessThan(p.stats.hunger);
  });

  it('health at 0 → downed (Phase 6 adds revive/death)', () => {
    const sim = makeSim();
    const p = sim.players.get(A)!;
    p.stats = { ...p.stats, health: 0.01, hunger: 0, thirst: 0 };
    run(sim, 2);
    expect(p.life).toBe('downed');
  });

  it('storm nights raise the water; pause stops time only in solo', () => {
    const sim = makeSim();
    const storm = sim.storms[0]!;
    sim.clock = { day: storm, minute: 17 * 60 + 59 };
    run(sim, 2);
    expect(sim.weather).toBe('storm');
    expect(sim.waterLevel).toBeCloseTo(sim.map.baseWaterLevel + sim.diff.waterRisePerStorm);

    sim.setPaused(A, true);
    expect(sim.paused).toBe(false); // co-op never pauses
    const solo = makeSim({ solo: true, players: 1 });
    solo.setPaused(A, true);
    const m = solo.clock.minute;
    run(solo, 5);
    expect(solo.clock.minute).toBe(m);
  });
});

describe('movement validation (server-authoritative)', () => {
  it('accepts walking and corrects teleports', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    run(sim, 0.5);
    sim.move(A, moveMsg(-5, p.y, -2, 500));
    expect(p.x).toBe(-5);
    sim.drainOut();
    run(sim, 0.1);
    sim.move(A, moveMsg(30, p.y, 30, 600));
    expect(p.x).toBe(-5);
    expect(types(sim)).toContain('correction');
  });

  it('a client clock running ahead cannot buy extra distance', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    run(sim, 0.2);
    sim.move(A, moveMsg(-6, p.y, -2, 200));
    run(sim, 0.1);
    // Claims 5 s passed when only 0.1 s did: 20 m would be fine at walk speed for 5 s.
    sim.move(A, moveMsg(-6, p.y, 3, 5200));
    expect(p.z).toBe(-2);
  });

  it('sprint speed only while server stamina allows it', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, 0);
    const y = p.y;
    run(sim, 0.2);
    sim.move(A, moveMsg(-6, y, 0, 200));
    // 0.5 s at sprint (4.6 × 1.6 ≈ 7.4 m/s) ≈ 3.7 m — too fast for walking (2.3 m + slack).
    run(sim, 0.5);
    sim.move(A, moveMsg(-6, y, 3.6, 700, { sprinting: true }));
    expect(p.z).toBeCloseTo(3.6);
    // Out of stamina → Hingal → sprint distance is rejected again.
    p.sprint = { ...p.sprint, stamina: 0, exhausted: true, sprinting: false };
    run(sim, 0.5);
    sim.move(A, moveMsg(-6, y, 7.2, 1200, { sprinting: true }));
    expect(p.z).toBeCloseTo(3.6);
    // …but normal walking is never slowed by exhaustion.
    run(sim, 0.5);
    sim.move(A, moveMsg(-6, y, 5.6, 1700, { sprinting: true }));
    expect(p.z).toBeCloseTo(5.6);
  });

  it('never corrects an honest client (15 Hz, jittery latency, walk + sprint)', () => {
    const sim = makeSim();
    const p = place(sim, A, -12, -8);
    const y = p.y;
    // Honest client path on the dry rooftops/bridges is not needed: depth only slows, so walk
    // in a straight line along x at full walk speed, sprinting in the middle third.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const samples: { arrive: number; msg: ClientMessage<'move'> }[] = [];
    let x = -12;
    let stamina = 100;
    for (let i = 1; i <= 90; i++) {
      const t = i / 15;
      const sprint = i > 30 && i <= 60 && stamina > 15;
      // Honest speed = the depth-limited maximum (wading is slower; no sprint when deep).
      const band = depthBand(depthAt(sim.map, x, -8, sim.waterLevel));
      const v =
        sim.cfg.actions.walkSpeed *
        DEPTH_SPEED[band] *
        (sprint && band !== 'waist' && band !== 'swim' ? sim.cfg.actions.sprintMultiplier : 1);
      if (sprint) stamina -= sim.cfg.actions.sprintDrainPerSec / 15;
      x += v / 15;
      samples.push({
        arrive: t + 0.03 + rand() * 0.15,
        msg: moveMsg(x, y, -8, Math.round(t * 1000), { sprinting: sprint }),
      });
    }
    samples.sort((a, b) => a.arrive - b.arrive);
    let corrections = 0;
    for (const sm of samples) {
      while (sim.time < sm.arrive) sim.tick(0.05);
      sim.move(A, sm.msg);
      corrections += sim.drainOut().filter((o) => o.type === 'correction').length;
    }
    expect(corrections).toBe(0);
  });

  it('rejects flying', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    run(sim, 0.3);
    sim.move(A, moveMsg(-6, p.y + 5, -2, 300));
    expect(types(sim)).toContain('correction');
  });
});

describe('jump and axe', () => {
  it('jump costs stamina and is locked while Hingal', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    sim.jump(A);
    expect(p.sprint.stamina).toBe(100 - config.actions.jumpStaminaCost);
    p.sprint = { ...p.sprint, stamina: 3, exhausted: true };
    sim.drainOut();
    sim.jump(A);
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({
        type: 'action:denied',
        payload: { action: 'jump', reason: 'hingal' },
      }),
    );
  });

  it('chops a tree with an equipped axe (wood, wear, cooldown); shove cannot chop', () => {
    const sim = makeSim();
    const p = place(sim, A, -20, 20.6); // tree_res_2 at (-20, 22)
    const yaw = Math.atan2(0, 1.4);
    sim.attack(A, { dir: yaw, clientSeq: 1 });
    expect(countItem(p.bag, 'wood')).toBe(0); // shove only

    run(sim, 1);
    const slot = give(sim, A, 'axe', 1);
    sim.equip(A, slot);
    expect(p.equip.hand).toBe('axe');
    sim.attack(A, { dir: yaw, clientSeq: 2 });
    expect(countItem(p.bag, 'wood')).toBe(1);
    expect(sim.chopsLeft.get('tree_res_2')).toBe(7);
    expect(p.bag[slot]!.durability).toBe(sim.items.get('axe')!.durability! - 1);
    sim.drainOut();
    sim.attack(A, { dir: yaw, clientSeq: 3 });
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({
        type: 'action:denied',
        payload: { action: 'attack', reason: 'cooldown' },
      }),
    );
  });

  it('teammates are never hit (no friendly fire)', () => {
    const sim = makeSim();
    place(sim, A, -6, -2);
    const b = place(sim, B, -6, -1);
    const slot = give(sim, A, 'axe', 1);
    sim.equip(A, slot);
    sim.attack(A, { dir: 0, clientSeq: 1 });
    expect(b.stats.health).toBe(100);
  });
});

describe('loot, bag, storage, giving', () => {
  it('loots a container after the hold; moving away cancels', () => {
    const sim = makeSim({ seed: 99 });
    const p = place(sim, A, 6.5, 0.5);
    sim.interact(A, 'loot:camp_roof_b_l1');
    expect(p.channel?.kind).toBe('loot');
    // Walk away → cancelled.
    run(sim, 0.2);
    sim.move(A, moveMsg(5, p.y, 0.5, 200));
    expect(p.channel).toBeNull();

    place(sim, A, 6.5, 0.5);
    sim.interact(A, 'loot:camp_roof_b_l1');
    run(sim, 1.1);
    expect(sim.lootOpened.has('camp_roof_b_l1')).toBe(true);
    expect(p.bag.some(Boolean)).toBe(true);
    sim.drainOut();
    sim.interact(A, 'loot:camp_roof_b_l1');
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({ payload: { action: 'interact', reason: 'gone' } }),
    );
  });

  it('loot is deterministic per seed, container and day', () => {
    const a = makeSim({ seed: 7 });
    const b = makeSim({ seed: 7 });
    for (const s of [a, b]) {
      place(s, A, 2.5, 0.5);
      s.interact(A, 'loot:camp_roof_b_l0');
      run(s, 1.1);
    }
    expect(a.players.get(A)!.bag).toEqual(b.players.get(A)!.bag);
  });

  it('refuses far interactions', () => {
    const sim = makeSim();
    place(sim, A, -6, -2);
    sim.interact(A, 'loot:camp_roof_b_l1');
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({ payload: { action: 'interact', reason: 'too_far' } }),
    );
  });

  it('drops and picks up items', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    const slot = give(sim, A, 'rope', 3);
    sim.bagDrop(A, slot, 2);
    expect(countItem(p.bag, 'rope')).toBe(1);
    const [id] = [...sim.drops.keys()];
    sim.interact(A, `drop:${id}`);
    expect(countItem(p.bag, 'rope')).toBe(3);
    expect(sim.drops.size).toBe(0);
  });

  it('camp storage only at camp, every change logged', () => {
    const sim = makeSim();
    const p = place(sim, A, 6, 2);
    give(sim, A, 'nails', 10);
    sim.deposit(A, 'nails', 10);
    expect(sim.storage.get('nails')).toBe(10);
    expect(countItem(p.bag, 'nails')).toBe(0);
    sim.withdraw(A, 'nails', 4);
    expect(sim.storage.get('nails')).toBe(6);
    expect(sim.activity.map((a) => a.action)).toEqual(['deposit', 'withdraw']);
    place(sim, A, -48, 0);
    sim.withdraw(A, 'nails', 1);
    expect(sim.storage.get('nails')).toBe(6);
  });

  it('give requires an accept from a nearby teammate', () => {
    const sim = makeSim();
    const a = place(sim, A, -6, -2);
    const b = place(sim, B, -5, -2);
    const slot = give(sim, A, 'biscuits', 2);
    sim.offerGive(A, B, slot);
    const offer = sim.drainOut().find((o) => o.type === 'give:offer')!;
    sim.acceptGive(A, offer.payload.offerId as string); // wrong user: ignored
    expect(countItem(b.bag, 'biscuits')).toBe(0);
    sim.acceptGive(B, offer.payload.offerId as string);
    expect(countItem(b.bag, 'biscuits')).toBe(2);
    expect(countItem(a.bag, 'biscuits')).toBe(0);
  });
});

describe('items and crafting', () => {
  it('using items applies effects, cures and records lessons', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    p.stats = { ...p.stats, effects: ['open_wound'], health: 50 };
    sim.useItem(A, give(sim, A, 'bandage', 1));
    expect(p.stats.effects).not.toContain('open_wound');
    expect(p.stats.health).toBeGreaterThan(50); // medic heals more
    expect(sim.learning.map((l) => l.eventKey)).toContain('bandaged_wound');

    sim.useItem(A, give(sim, A, 'boots', 1));
    expect(p.equip.feet).toBe('boots');
    sim.useItem(A, give(sim, A, 'dirty_water', 1));
    expect(sim.learning.find((l) => l.eventKey === 'drank_unsafe_water')?.isPositive).toBe(false);
  });

  it('crafts on a timer; structures need the camp; boiling needs the fire', () => {
    const sim = makeSim();
    const p = place(sim, A, -48, 0); // away from camp
    give(sim, A, 'clean_cloth', 2);
    sim.craft(A, 'bandage');
    run(sim, 3.1);
    expect(countItem(p.bag, 'bandage')).toBe(1);

    give(sim, A, 'wood', 3);
    give(sim, A, 'lighter', 1);
    sim.drainOut();
    sim.craft(A, 'campfire');
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({ payload: { action: 'craft', reason: 'not_here' } }),
    );

    place(sim, A, -5, 1);
    give(sim, A, 'dirty_water', 1);
    give(sim, A, 'cooking_pot', 1);
    sim.drainOut();
    sim.craft(A, 'boiled_water');
    expect(sim.drainOut()).toContainEqual(
      expect.objectContaining({ payload: { action: 'craft', reason: 'needs_fire' } }),
    );

    sim.craft(A, 'campfire');
    run(sim, 5.1);
    expect(sim.fireLit()).toBe(true);
    sim.craft(A, 'boiled_water');
    run(sim, 5.1);
    expect(countItem(p.bag, 'boiled_water')).toBe(1);
  });
});

describe('connection state', () => {
  it('disconnected players are safe and cannot act', () => {
    const sim = makeSim();
    const p = place(sim, A, -6, -2);
    sim.setConnected(A, false);
    expect(p.life).toBe('disconnected');
    sim.jump(A);
    expect(p.sprint.stamina).toBe(100);
    run(sim, 30);
    expect(p.stats.hunger).toBe(100);
    sim.setConnected(A, true);
    expect(p.life).toBe('alive');
  });
});
