import {
  createStateRng,
  type Bag,
  type Clock,
  type PlayerStats,
  type StatusEffect,
} from '@baha/shared/survival';
import type { Crate, HeliPhase, Npc } from './objectives.ts';
import type { Drop, Simulation } from './simulation.ts';
import type { ActivityEntry, LifeState, Weather } from './types.ts';

/** Bump when the snapshot shape changes incompatibly (old snapshots then need a migration). */
export const SNAPSHOT_VERSION = 1;

interface PlayerSnap {
  role: string;
  username: string;
  x: number;
  y: number;
  z: number;
  life: LifeState;
  stats: PlayerStats;
  stamina: number;
  bag: Bag;
  equip: { hand: string | null; body: string | null; feet: string | null };
  pendingRespawn: boolean;
  spectator: boolean;
  deaths: number;
  revivesGiven: number;
  boatStagesBuilt: number;
  rescued: boolean;
}

/**
 * Everything needed to resume a run exactly (Section 16.6): world, players, bags, storage,
 * camp, boat, loot state, NPCs, time, weather, RNG state and the learning log. JSON-safe.
 */
export interface Snapshot {
  v: number;
  seed: number;
  rngState: number;
  playedSec: number;
  time: number;
  clock: Clock;
  weather: Weather;
  waterLevel: number;
  lastHour: number;
  players: Record<string, PlayerSnap>;
  lootOpened: string[];
  drops: [string, Drop][];
  dropSeq: number;
  chopsLeft: Record<string, number>;
  storage: Record<string, number>;
  camp: { structures: string[]; fireMinutesLeft: number; workbenchTier: number; level: number };
  activity: ActivityEntry[];
  flags: string[];
  /** [userId, eventKey, positive, day] */
  learningLog: [string | null, string, boolean, number][];
  obj: {
    boat: { stage: number; progress: number; deposited: Record<string, number> };
    campUpgrade: { progress: number; deposited: Record<string, number> };
    signal: { fireLit: boolean; sosFlashed: boolean };
    npcs: Npc[];
    crates: Crate[];
    heli: { phase: HeliPhase; aliveAtWindow: number };
    secondWindsUsed: number;
    counters: { deaths: number; hazardHits: number; sicknessEvents: number; npcsRescued: number };
    lastHourKey: number;
  };
}

const rec = (m: Map<string, number>) => Object.fromEntries(m);

export function toSnapshot(sim: Simulation): Snapshot {
  const players: Record<string, PlayerSnap> = {};
  for (const p of sim.players.values())
    players[p.userId] = {
      role: p.role,
      username: p.username,
      x: p.x,
      y: p.y,
      z: p.z,
      life: p.life === 'disconnected' ? 'alive' : p.life,
      stats: p.stats,
      stamina: p.sprint.stamina,
      bag: p.bag,
      equip: p.equip,
      pendingRespawn: p.pendingRespawn,
      spectator: p.spectator,
      deaths: p.deaths,
      revivesGiven: p.revivesGiven,
      boatStagesBuilt: p.boatStagesBuilt,
      rescued: p.rescued,
    };
  const o = sim.obj;
  return {
    v: SNAPSHOT_VERSION,
    seed: sim.seed,
    rngState: sim.rng.getState(),
    playedSec: sim.playedSec,
    time: sim.time,
    clock: { ...sim.clock },
    weather: sim.weather,
    waterLevel: sim.waterLevel,
    lastHour: sim.lastHour,
    players,
    lootOpened: [...sim.lootOpened],
    drops: [...sim.drops],
    dropSeq: sim.dropSeq,
    chopsLeft: rec(sim.chopsLeft),
    storage: rec(sim.storage),
    camp: {
      structures: [...sim.camp.structures],
      fireMinutesLeft: sim.camp.fireMinutesLeft,
      workbenchTier: sim.camp.workbenchTier,
      level: sim.camp.level,
    },
    activity: sim.activity.slice(-100),
    flags: [...sim.flags],
    learningLog: sim.learningLog.map((l) => [l.userId, l.eventKey, l.isPositive, l.day]),
    obj: {
      boat: { stage: o.boat.stage, progress: o.boat.progress, deposited: rec(o.boat.deposited) },
      campUpgrade: { progress: o.campUpgrade.progress, deposited: rec(o.campUpgrade.deposited) },
      signal: { ...o.signal },
      npcs: [...o.npcs.values()].map((n) => ({ ...n })),
      crates: [...o.crates.values()],
      heli: { phase: o.heli.phase, aliveAtWindow: o.heli.aliveAtWindow },
      secondWindsUsed: o.secondWindsUsed,
      counters: { ...o.counters },
      lastHourKey: o.lastHourKey,
    },
  };
}

const setMap = (m: Map<string, number>, r: Record<string, number>) => {
  m.clear();
  for (const [k, v] of Object.entries(r)) m.set(k, v);
};

/**
 * Restores a snapshot onto a freshly constructed Simulation (same seed/config/players).
 * Everyone starts "disconnected" (safe) until they join this session; holds, boat trips and
 * pending helicopter arrivals restart cleanly; downed players resume barely alive.
 */
export function applySnapshot(sim: Simulation, s: Snapshot) {
  if (s.v !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot v${s.v}`);
  sim.rng = createStateRng(s.rngState);
  sim.playedSec = s.playedSec;
  sim.time = s.time;
  sim.clock = { ...s.clock };
  sim.weather = s.weather;
  sim.waterLevel = s.waterLevel;
  sim.lastHour = s.lastHour;
  for (const [uid, ps] of Object.entries(s.players)) {
    const p =
      sim.players.get(uid) ?? sim.addPlayer({ userId: uid, username: ps.username, role: ps.role });
    p.role = ps.role;
    p.stats = { ...ps.stats, effects: [...ps.stats.effects] as StatusEffect[] };
    p.sprint = { ...p.sprint, stamina: ps.stamina };
    p.bag = ps.bag.map((x) => (x ? { ...x } : null));
    p.equip = { ...ps.equip };
    p.pendingRespawn = ps.pendingRespawn;
    p.spectator = ps.spectator;
    p.deaths = ps.deaths;
    p.revivesGiven = ps.revivesGiven;
    p.boatStagesBuilt = ps.boatStagesBuilt;
    p.rescued = ps.rescued;
    sim.placeAt(p, ps.x, ps.z, ps.y);
    p.life = ps.life;
    // A save never strands someone mid bleed-out: they resume barely alive, protected.
    if (p.life === 'downed') {
      p.life = 'alive';
      p.stats = { ...p.stats, health: 15 };
      p.protectedUntil = sim.time + sim.cfg.session.respawnProtectionSec;
    }
    sim.dirty.bags.add(uid);
  }
  sim.lootOpened.clear();
  for (const id of s.lootOpened) sim.lootOpened.add(id);
  sim.drops.clear();
  for (const [id, d] of s.drops) sim.drops.set(id, d);
  sim.dropSeq = s.dropSeq;
  setMap(sim.chopsLeft, s.chopsLeft);
  setMap(sim.storage, s.storage);
  sim.camp.structures.clear();
  for (const st of s.camp.structures) sim.camp.structures.add(st);
  sim.camp.fireMinutesLeft = s.camp.fireMinutesLeft;
  sim.camp.workbenchTier = s.camp.workbenchTier;
  sim.camp.level = s.camp.level;
  sim.activity.splice(0, sim.activity.length, ...s.activity);
  for (const f of s.flags) sim.flags.add(f);
  sim.learningLog.splice(
    0,
    sim.learningLog.length,
    ...s.learningLog.map(([userId, eventKey, isPositive, day]) => ({
      userId,
      eventKey,
      isPositive,
      day,
    })),
  );

  const o = sim.obj;
  o.boat.stage = s.obj.boat.stage;
  o.boat.progress = s.obj.boat.progress;
  setMap(o.boat.deposited, s.obj.boat.deposited);
  o.campUpgrade.progress = s.obj.campUpgrade.progress;
  setMap(o.campUpgrade.deposited, s.obj.campUpgrade.deposited);
  Object.assign(o.signal, s.obj.signal);
  o.npcs.clear();
  for (const n of s.obj.npcs)
    o.npcs.set(n.id, {
      ...n,
      state: n.state === 'following' ? 'waiting' : n.state,
      followUserId: null,
    });
  o.crates.clear();
  for (const c of s.obj.crates) o.crates.set(c.id, c);
  // A helicopter that was mid-approach waits for the team again.
  o.heli = {
    phase:
      s.obj.heli.phase === 'none' || s.obj.heli.phase === 'done' ? s.obj.heli.phase : 'incoming',
    at: sim.time,
    aliveAtWindow: s.obj.heli.aliveAtWindow,
  };
  o.secondWindsUsed = s.obj.secondWindsUsed;
  Object.assign(o.counters, s.obj.counters);
  o.lastHourKey = s.obj.lastHourKey;
  o.dirty = { boat: true, npcs: true, crates: true, heli: true };

  // Nobody is "here" until they join this session.
  for (const p of sim.players.values()) sim.setConnected(p.userId, false);
  sim.drainOut();
}
