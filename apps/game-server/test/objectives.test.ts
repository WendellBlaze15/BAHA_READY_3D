import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVIVAL_CONFIG,
  countItem,
  groundAt,
  survivalConfigSchema,
  survivalScore,
  type SurvivalConfig,
} from '@baha/shared/survival';
import { Simulation } from '../src/sim/simulation.ts';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const base = survivalConfigSchema.parse(DEFAULT_SURVIVAL_CONFIG);

function cfgWith(patch: (c: SurvivalConfig) => void) {
  const c = structuredClone(base);
  patch(c);
  return survivalConfigSchema.parse(c);
}

function makeSim(
  o: {
    difficulty?: 'easy' | 'normal' | 'hard';
    solo?: boolean;
    config?: SurvivalConfig;
    roles?: string[];
    seed?: number;
  } = {},
) {
  const roles = o.roles ?? (o.solo ? ['solo'] : ['medic', 'builder']);
  return new Simulation({
    config: o.config ?? base,
    difficulty: o.difficulty ?? 'normal',
    seed: o.seed ?? 77,
    solo: !!o.solo,
    players: roles.map((role, i) => ({ userId: [A, B][i]!, username: `p${i}`, role })),
  });
}

function place(sim: Simulation, uid: string, x: number, z: number) {
  const p = sim.players.get(uid)!;
  sim.placeAt(p, x, z);
  sim.drainOut();
  return p;
}

function grant(sim: Simulation, uid: string, item: string, qty: number) {
  sim.obj.grant(sim.players.get(uid)!, item, qty);
}

function run(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) sim.tick(0.05);
}

/** Jumps the clock to just before `hour` on `day` and runs until the hour has passed. */
function toHour(sim: Simulation, day: number, hour: number) {
  sim.clock = { day, minute: hour * 60 - 1 };
  run(sim, 1.2);
}

const events = (sim: Simulation) =>
  sim
    .drainOut()
    .filter((o) => o.type === 'event')
    .map((o) => o.payload.kind);
const denied = (sim: Simulation) =>
  sim
    .drainOut()
    .filter((o) => o.type === 'action:denied')
    .map((o) => o.payload.reason);

describe('boat and camp building', () => {
  it('deposits materials, needs tools, builds faster with a Builder, storms damage uncovered work', () => {
    const sim = makeSim();
    const need = sim.obj.boatNeeds()!;
    const dock = sim.map.boatDock;
    place(sim, A, dock.x, dock.z);
    place(sim, B, dock.x + 1, dock.z);
    for (const m of need.materials) grant(sim, A, m.item, m.qty);

    sim.obj.build(A, 'boat', 'work');
    expect(denied(sim)).toContain('missing_materials');
    sim.obj.build(A, 'boat', 'deposit');
    expect(need.materials.every((m) => sim.obj.boat.deposited.get(m.item) === m.qty)).toBe(true);
    sim.obj.build(A, 'boat', 'work');
    expect(denied(sim)).toContain('missing_tools'); // hammer

    grant(sim, A, 'hammer', 1);
    grant(sim, B, 'hammer', 1);
    sim.obj.build(A, 'boat', 'work');
    sim.obj.build(B, 'boat', 'work'); // builder perk: faster
    run(sim, 10);
    const p = sim.obj.boat.progress;
    const stage = sim.cfg.boatStages[0]!;
    expect(p).toBeCloseTo((10 * (1 + sim.cfg.roles.builder.buildSpeedMul)) / stage.workSeconds, 1);

    // Storm night without a build-site cover takes progress away.
    sim.obj.onStormStart();
    expect(sim.obj.boat.progress).toBeCloseTo(
      Math.max(0, p - sim.cfg.events.stormBoatProgressLoss),
      5,
    );

    run(sim, stage.workSeconds);
    expect(sim.obj.boat.stage).toBe(1);
    expect(sim.players.get(A)!.channel).toBeNull();
  });

  it('builder saves nails and rope; later stages need workbench tier 2 (camp level 2)', () => {
    const solo = makeSim({ roles: ['medic', 'scout'] }).obj.boatNeeds()!;
    const withBuilder = makeSim().obj.boatNeeds()!;
    const nails = (n: typeof solo) => n.materials.find((m) => m.item === 'nails')!.qty;
    expect(nails(withBuilder)).toBeLessThan(nails(solo));

    const sim = makeSim();
    sim.obj.boat.stage = 2; // stage 3 requires workbench 2
    const need = sim.obj.boatNeeds()!;
    place(sim, A, sim.map.boatDock.x, sim.map.boatDock.z);
    for (const m of need.materials) grant(sim, A, m.item, m.qty);
    sim.obj.build(A, 'boat', 'deposit');
    sim.obj.build(A, 'boat', 'work');
    expect(denied(sim)).toContain('needs_workbench');

    const up = sim.obj.campNeeds()!;
    place(sim, A, 0, 4);
    for (const m of up.materials) grant(sim, A, m.item, m.qty);
    sim.obj.build(A, 'camp', 'deposit');
    sim.obj.build(A, 'camp', 'work');
    run(sim, sim.cfg.campUpgrades[0]!.workSeconds + 1);
    expect(sim.camp.level).toBe(2);
    expect(sim.camp.workbenchTier).toBe(2);
  });
});

describe('downed, revive, death (Section 12)', () => {
  it('teammate revive with a bandage → 30% health; medic is faster; moving cancels', () => {
    const sim = makeSim();
    const a = place(sim, A, -6, -2); // medic
    const b = place(sim, B, -5, -2);
    sim.obj.down(b);
    expect(b.life).toBe('downed');
    sim.obj.revive(A, B);
    expect(denied(sim)).toContain('needs_bandage');
    grant(sim, A, 'bandage', 1);
    sim.obj.revive(A, B);
    expect(a.channel?.kind).toBe('revive');
    run(sim, sim.cfg.session.medicReviveSeconds + 0.1);
    expect(b.life).toBe('alive');
    expect(b.stats.health).toBe(30);
    expect(countItem(a.bag, 'bandage')).toBe(0);
    expect(a.revivesGiven).toBe(1);
    expect(sim.time).toBeLessThan(b.protectedUntil); // respawn/revive protection
  });

  it('bleed-out → death; Normal drops the bag at the death spot and respawns at dawn', () => {
    const sim = makeSim();
    const b = place(sim, B, -5, -2);
    grant(sim, B, 'rope', 3);
    sim.obj.down(b);
    run(sim, sim.diff.bleedOutSec + 0.5);
    expect(b.life).toBe('dead');
    expect(countItem(b.bag, 'rope')).toBe(0);
    expect(
      [...sim.drops.values()].some((d) => d.item === 'rope' && d.expiresAtMin !== undefined),
    ).toBe(true);
    sim.clock = { day: 1, minute: 4 * 60 + 59 };
    run(sim, 2);
    expect(b.life).toBe('alive');
    expect(sim.time).toBeLessThan(b.protectedUntil);
  });

  it('Easy keeps the bag with a 20% stat penalty; Hard is permadeath (spectator)', () => {
    const easy = makeSim({ difficulty: 'easy' });
    const e = place(easy, B, -5, -2);
    grant(easy, B, 'rope', 2);
    easy.obj.down(e);
    run(easy, easy.diff.bleedOutSec + 0.5);
    expect(countItem(e.bag, 'rope')).toBe(2);
    easy.clock = { day: 1, minute: 4 * 60 + 59 };
    run(easy, 2);
    expect(e.stats.health).toBeCloseTo(80, 0); // +natural regen since dawn

    const hard = makeSim({ difficulty: 'hard' });
    const h = place(hard, B, -5, -2);
    hard.obj.down(h);
    run(hard, hard.diff.bleedOutSec + 0.5);
    expect(h.spectator).toBe(true);
    hard.clock = { day: 1, minute: 4 * 60 + 59 };
    run(hard, 2);
    expect(h.life).toBe('dead');
  });

  it('everyone down: Hard loses the run; Normal respawns with a boat penalty', () => {
    const hard = makeSim({ difficulty: 'hard' });
    for (const uid of [A, B]) hard.obj.down(hard.players.get(uid)!);
    run(hard, hard.diff.bleedOutSec + 0.5);
    expect(hard.obj.result?.ending).toBe('failed');

    const normal = makeSim();
    normal.obj.boat.progress = 0.8;
    for (const uid of [A, B]) normal.obj.down(normal.players.get(uid)!);
    run(normal, normal.diff.bleedOutSec + 0.5);
    expect(normal.obj.result).toBeNull();
    expect(normal.obj.boat.progress).toBeCloseTo(0.8 - normal.cfg.events.allDeadBoatProgressLoss);
  });

  it('solo Second Wind is limited per difficulty', () => {
    const sim = makeSim({ solo: true, difficulty: 'hard' }); // 1 Second Wind
    const a = place(sim, A, -6, -2);
    grant(sim, A, 'bandage', 3);
    sim.obj.down(a);
    sim.obj.revive(A, A);
    run(sim, sim.cfg.session.secondWindSeconds + 0.1);
    expect(a.life).toBe('alive');
    sim.obj.down(a);
    sim.obj.revive(A, A);
    expect(denied(sim)).toContain('no_second_winds');
  });
});

describe('hazards (warned first) and critters', () => {
  it('live wires: a warning when near, instantly downed in the water inside', () => {
    const sim = makeSim();
    const wires = sim.map.hazards.find((h) => h.kind === 'live_wire')!;
    place(sim, A, wires.rect.x - wires.rect.w / 2 - 3, wires.rect.z);
    run(sim, 1.1);
    expect(sim.drainOut().some((o) => o.type === 'hazard:warn')).toBe(true);
    const a = place(sim, A, wires.rect.x, wires.rect.z);
    run(sim, 1.1);
    expect(a.life).toBe('downed');
    expect(
      sim.learningLog.some((l) => l.eventKey === 'entered_live_wire_water' && !l.isPositive),
    ).toBe(true);
  });

  it('rat bites at night cause open wounds unless wearing boots; swinging scares them', () => {
    const cfg = cfgWith((c) => {
      c.hazards.ratBiteChancePerMin = 1;
    });
    const sim = makeSim({ config: cfg });
    const rats = sim.map.hazards.find((h) => h.kind === 'rats')!;
    sim.clock = { day: 1, minute: 22 * 60 };
    run(sim, 1.1);
    const a = place(sim, A, rats.rect.x, rats.rect.z);
    run(sim, 2.1);
    expect(a.stats.effects).toContain('open_wound');

    const b = place(sim, B, rats.rect.x + 1, rats.rect.z);
    grant(sim, B, 'boots', 1);
    sim.equip(
      B,
      b.bag.findIndex((s) => s?.item === 'boots'),
    );
    run(sim, 2.1);
    expect(b.stats.effects).not.toContain('open_wound');

    a.stats = { ...a.stats, effects: [] };
    sim.attack(A, { dir: 0, clientSeq: 1 });
    run(sim, 2.1);
    expect(a.stats.effects).not.toContain('open_wound');
  });
});

describe('events: radio, supply drops, survivors, sleep', () => {
  it('radio broadcast at 07:00 with a weather hint for the Radio Operator', () => {
    const sim = makeSim({ roles: ['radio', 'builder'] });
    toHour(sim, 2, sim.cfg.events.radioHour);
    const out = sim.drainOut();
    expect(out.some((o) => o.type === 'event' && o.payload.kind === 'radio')).toBe(true);
    expect(out.filter((o) => o.type === 'radio:weather').map((o) => o.to)).toEqual([A]);
  });

  it('supply drop: Radio Operator hears early, crate appears, opens with loot', () => {
    const sim = makeSim({ roles: ['radio', 'builder'] });
    const day = sim.diff.supplyDropEveryDays;
    const warnHour = Math.floor(
      (sim.cfg.events.supplyDropHour * 60 - sim.cfg.roles.radio.earlyWarningMin) / 60,
    );
    toHour(sim, day, warnHour);
    expect(
      sim.drainOut().find((o) => o.type === 'event' && o.payload.kind === 'supply_incoming')?.to,
    ).toBe(A);
    toHour(sim, day, sim.cfg.events.supplyDropHour);
    const crate = [...sim.obj.crates.values()][0]!;
    expect(crate).toBeDefined();
    const a = place(sim, A, crate.x, crate.z);
    sim.interact(A, `loot:${crate.id}`);
    run(sim, 2.1);
    expect(sim.obj.crates.size).toBe(0);
    expect(a.bag.some(Boolean)).toBe(true);
  });

  it('stranded survivor: help with food, escort to camp, rescued with a gift', () => {
    const sim = makeSim();
    const n = [...sim.obj.npcs.values()][0]!;
    toHour(sim, n.appearDay, 8);
    expect(n.state).toBe('waiting');
    const a = place(sim, A, n.x + 1, n.z);
    sim.interact(A, `npc:${n.id}`);
    expect(denied(sim)).toContain('needs_food_or_water');
    grant(sim, A, 'biscuits', 1);
    sim.interact(A, `npc:${n.id}`);
    expect(n.state).toBe('following');
    place(sim, A, 0, 4); // walk back to camp (teleport for the test)
    run(sim, 30);
    expect(n.state).toBe('rescued');
    expect(sim.obj.counters.npcsRescued).toBe(1);
    expect(a.bag.some((s) => s && sim.items.get(s.item)?.rarity === 'rare')).toBe(true);
  });

  it('sleeping in the shelter at night speeds time up', () => {
    const sim = makeSim();
    sim.camp.structures.add('shelter');
    sim.clock = { day: 1, minute: 21 * 60 };
    run(sim, 1.1); // day phase updates on the next stat step
    for (const uid of [A, B]) place(sim, uid, 0, 4);
    sim.interact(A, 'sleep');
    sim.interact(B, 'sleep');
    const m0 = sim.clock.minute;
    run(sim, 10);
    expect(sim.clock.minute - m0).toBeCloseTo(30 * sim.cfg.session.sleepSpeedup, 0);
  });
});

describe('Day 30: boat trip, signal, helicopter, ending + score', () => {
  const short = cfgWith((c) => {
    c.session.totalDays = 3;
    c.events.boatTravelSec = 5;
    c.events.heliArriveSec = 1;
    c.events.heliLiftSecPerPlayer = 1;
  });

  function readyForRescue() {
    const sim = makeSim({ config: short });
    sim.obj.boat.stage = sim.cfg.boatStages.length;
    sim.camp.structures.add('signal_fire');
    toHour(sim, 3, sim.diff.heliWindow.start);
    expect(sim.obj.heli.phase).toBe('incoming');
    return sim;
  }

  it('full rescue: boat → rescue point, light the signal fire, everyone lifted', () => {
    const sim = readyForRescue();
    for (const uid of [A, B]) place(sim, uid, sim.map.boatDock.x, sim.map.boatDock.z);
    sim.interact(A, 'boat');
    expect(sim.players.get(B)!.onBoat).toBe(true);
    run(sim, 6);
    const rp = sim.map.rescuePoint;
    expect(Math.hypot(sim.players.get(A)!.x - rp.x, sim.players.get(A)!.z - rp.z)).toBeLessThan(
      rp.r,
    );

    const a = place(sim, A, sim.map.signalSpot.x, sim.map.signalSpot.z);
    grant(sim, A, 'lighter', 1);
    sim.obj.build(A, 'signal', 'work');
    expect(sim.obj.signalActive()).toBe(true);
    place(sim, A, rp.x, rp.z);
    run(sim, 5);
    const r = sim.obj.result!;
    expect(r.ending).toBe('full_rescue');
    expect(r.summary.playersRescued).toBe(2);
    expect(r.score).toBe(survivalScore(r.summary, sim.cfg.scoring, sim.diff).final);
    expect(sim.drainOut().some((o) => o.type === 'ended')).toBe(true);
    expect(a.rescued).toBe(true);
  });

  it('no signal → the helicopter never sees them: failed when the window closes', () => {
    const sim = readyForRescue();
    sim.camp.structures.delete('signal_fire');
    for (const uid of [A, B]) place(sim, uid, sim.map.rescuePoint.x, sim.map.rescuePoint.z);
    toHour(sim, 3, sim.diff.heliWindow.end);
    expect(sim.obj.result?.ending).toBe('failed');
  });

  it('SOS sign + mirror while the helicopter is near counts as a signal', () => {
    const sim = readyForRescue();
    sim.camp.structures.delete('signal_fire');
    sim.camp.structures.add('sos_sign');
    place(sim, A, sim.map.rescuePoint.x, sim.map.rescuePoint.z);
    grant(sim, A, 'mirror', 1);
    sim.useItem(
      A,
      sim.players.get(A)!.bag.findIndex((s) => s?.item === 'mirror'),
    );
    expect(sim.obj.signalActive()).toBe(true);
    expect(sim.learningLog.some((l) => l.eventKey === 'signaled_rescuers')).toBe(true);
  });

  it('a player left behind makes it a partial rescue', () => {
    const sim = readyForRescue();
    place(sim, A, sim.map.rescuePoint.x, sim.map.rescuePoint.z);
    place(sim, B, -6, -2); // stays at camp
    sim.obj.signal.fireLit = true;
    run(sim, 3);
    toHour(sim, 3, sim.diff.heliWindow.end);
    expect(sim.obj.result?.ending).toBe('partial_rescue');
    expect(groundAt(sim.map, 0, 0)).toBeDefined();
  });
});
