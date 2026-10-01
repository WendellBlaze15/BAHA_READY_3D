import {
  RADIO_TIPS,
  addItem,
  allDeadOutcome,
  countItem,
  createStateRng,
  deathOutcome,
  decideEnding,
  depthAt,
  depthBand,
  dist2,
  freshStats,
  groundAt,
  helicopterWindowOpen,
  helicopterWindowOver,
  inRect,
  removeItem,
  reviveHealth,
  reviveSeconds,
  rollLoot,
  scaledBoatMaterials,
  subSeed,
  survivalScore,
  type Ending,
  type HazardZone,
  type Rect,
  type RunSummary,
  type ZoneKey,
} from '@baha/shared/survival';
import type { Simulation } from './simulation.ts';
import type { SimPlayer } from './types.ts';

const MINUTES_PER_DAY = 1440;
const REVIVE_RANGE_M = 3;
/** Distance around the dock / build site that counts as "at the boat". */
const DOCK_REACH_M = 4;
const SIGNAL_ITEMS = new Set(['mirror', 'flare', 'whistle']);
const WARN_THROTTLE_SEC = 5;
const NPC_FOLLOW_GAP_M = 2;
const MATERIAL_SAVE_ITEMS = new Set(['nails', 'rope']);

export type HeliPhase = 'none' | 'incoming' | 'arriving' | 'lifting' | 'done';
export type NpcState = 'hidden' | 'waiting' | 'following' | 'rescued' | 'evacuated';

export interface Npc {
  id: string;
  x: number;
  z: number;
  zone: ZoneKey;
  appearDay: number;
  state: NpcState;
  followUserId: string | null;
  spottedAt: number | null;
}

export interface Crate {
  id: string;
  x: number;
  z: number;
  zone: ZoneKey;
}

export interface RunResult {
  ending: Ending;
  score: number;
  baseScore: number;
  summary: RunSummary;
  perPlayer: Record<
    string,
    { rescued: boolean; deaths: number; revivesGiven: number; good: number; risky: number }
  >;
  /** eventKey → { positive count, negative count } for "Mga Natutunan". */
  learning: Record<string, { good: number; bad: number }>;
}

const expand = (r: Rect, m: number): Rect => ({ x: r.x, z: r.z, w: r.w + 2 * m, d: r.d + 2 * m });
const absMinutes = (c: { day: number; minute: number }) => c.day * MINUTES_PER_DAY + c.minute;

/**
 * Phase 6 rules (Sections 10–14) on top of the core simulation: boat stages, camp upgrades,
 * signal, downed → revive / Second Wind → death and respawn per difficulty, storms damaging
 * uncovered builds, supply drops, stranded survivors, radio broadcasts, hazards (always warned
 * first), sleeping, the Day-30 boat trip + helicopter, endings and the server-computed score.
 */
export class Objectives {
  readonly boat = { stage: 0, progress: 0, deposited: new Map<string, number>() };
  readonly campUpgrade = { progress: 0, deposited: new Map<string, number>() };
  readonly signal = { fireLit: false, sosFlashed: false };
  readonly npcs = new Map<string, Npc>();
  readonly crates = new Map<string, Crate>();
  heli: { phase: HeliPhase; at: number; aliveAtWindow: number } = {
    phase: 'none',
    at: 0,
    aliveAtWindow: 0,
  };
  boatTrip: { departAt: number; arriveAt: number; riders: string[] } | null = null;
  secondWindsUsed = 0;
  counters = { deaths: 0, hazardHits: 0, sicknessEvents: 0, npcsRescued: 0 };
  result: RunResult | null = null;
  /** Dirty flags for the sync layer. */
  dirty = { boat: true, npcs: true, crates: true, heli: true };

  lastHourKey = -1;
  private collapseAt: { id: string; at: number } | null = null;

  constructor(private sim: Simulation) {
    const cfg = sim.cfg;
    const rng = createStateRng(subSeed(sim.seed, 'survivors'));
    const spots = [...sim.map.npcSpots];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    }
    const n = Math.min(spots.length, rng.int(cfg.survivors.min, cfg.survivors.max));
    const lastDay = Math.max(2, cfg.session.totalDays - 6);
    for (let i = 0; i < n; i++) {
      const s = spots[i]!;
      this.npcs.set(`npc${i}`, {
        id: `npc${i}`,
        x: s.x,
        z: s.z,
        zone: s.zone,
        appearDay: rng.int(Math.min(2, lastDay), lastDay),
        state: 'hidden',
        followUserId: null,
        spottedAt: null,
      });
    }
  }

  // ── Per-tick (20 Hz) ──────────────────────────────────────────────────────

  tick(dt: number) {
    const sim = this.sim;
    if (this.result) return;
    // Bleed-out timers.
    for (const p of sim.players.values())
      if (p.life === 'downed' && p.bleedOutAt !== null && sim.time >= p.bleedOutAt) this.die(p);

    // Building: every worker on the site adds progress (more builders = faster).
    for (const p of sim.players.values()) {
      if (p.life !== 'alive' || p.channel?.kind !== 'build') continue;
      const target = p.channel.target;
      const mul = sim.perk(p, 'buildSpeedMul');
      if (target === 'boat') {
        const stage = sim.cfg.boatStages[this.boat.stage];
        if (!stage) continue;
        this.boat.progress += (dt * mul) / stage.workSeconds;
        this.dirty.boat = true;
        if (this.boat.progress >= 1) this.completeBoatStage();
      } else if (target === 'camp') {
        const up = sim.cfg.campUpgrades[sim.camp.level - 1];
        if (!up) continue;
        this.campUpgrade.progress += (dt * mul) / up.workSeconds;
        sim.dirty.camp = true;
        if (this.campUpgrade.progress >= 1) this.completeCampUpgrade();
      }
    }

    // NPCs follow their escort.
    for (const n of this.npcs.values()) {
      if (n.state !== 'following') continue;
      const p = n.followUserId ? sim.players.get(n.followUserId) : undefined;
      if (!p || p.life !== 'alive') {
        n.state = 'waiting';
        n.followUserId = null;
        this.dirty.npcs = true;
        continue;
      }
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (d > NPC_FOLLOW_GAP_M) {
        const step = Math.min(d - NPC_FOLLOW_GAP_M, sim.cfg.actions.walkSpeed * 1.2 * dt);
        n.x += ((p.x - n.x) / d) * step;
        n.z += ((p.z - n.z) / d) * step;
        this.dirty.npcs = true;
      }
      if (inRect(sim.map.camp, n.x, n.z)) this.rescueNpc(n, p);
    }

    this.tickBoatTrip();
    this.tickHelicopter();
    if (this.collapseAt && sim.time >= this.collapseAt.at) this.collapse(this.collapseAt.id);
  }

  // ── Per stat step (in-game minutes) ───────────────────────────────────────

  minuteStep(minutes: number, crossedDawn: boolean) {
    const sim = this.sim;
    if (this.result) return;
    if (crossedDawn) this.dawn();

    const hourKey = sim.clock.day * 24 + Math.floor(sim.clock.minute / 60);
    if (hourKey !== this.lastHourKey) {
      this.lastHourKey = hourKey;
      this.onHour(Math.floor(sim.clock.minute / 60));
    }
    this.hazards(minutes);
    this.expireDrops();
    this.checkSurvivorTimeouts();
  }

  private onHour(hour: number) {
    const sim = this.sim;
    const ev = sim.cfg.events;
    const day = sim.clock.day;
    if (hour === ev.radioHour) {
      const tip = createStateRng(subSeed(sim.seed, `radio:${day}`)).int(0, RADIO_TIPS.length - 1);
      sim.send('all', 'event', { kind: 'radio', day, tip });
      const next = sim.storms.find((d) => d > day);
      for (const p of sim.players.values())
        if (p.role === 'radio' || p.role === 'solo' || countItem(p.bag, 'radio') > 0)
          sim.send(p.userId, 'radio:weather', { nextStormDay: next ?? null });
    }
    // Supply drop (Radio Operator hears about it ahead of time).
    const every = sim.diff.supplyDropEveryDays;
    if (day % every === 0) {
      const warnMin = Math.max(
        ...[...sim.players.values()].map((p) => sim.perk(p, 'earlyWarningMin')),
      );
      const warnHour = Math.floor((ev.supplyDropHour * 60 - warnMin) / 60);
      if (warnMin > 0 && hour === warnHour && warnHour < ev.supplyDropHour) {
        const c = this.plannedCrate(day);
        for (const p of sim.players.values())
          if (sim.perk(p, 'earlyWarningMin') > 0)
            sim.send(p.userId, 'event', {
              kind: 'supply_incoming',
              x: c.x,
              z: c.z,
              inHours: ev.supplyDropHour - hour,
            });
      }
      if (hour === ev.supplyDropHour) {
        const c = this.plannedCrate(day);
        this.crates.set(c.id, c);
        this.dirty.crates = true;
        sim.send('all', 'event', { kind: 'supply_drop', id: c.id, x: c.x, z: c.z });
      }
    }
    // Stranded survivors appear in the morning.
    if (hour === 8)
      for (const n of this.npcs.values())
        if (n.state === 'hidden' && n.appearDay === day) {
          n.state = 'waiting';
          n.spottedAt = absMinutes(sim.clock);
          this.dirty.npcs = true;
          sim.send('all', 'event', { kind: 'survivor_spotted', id: n.id, x: n.x, z: n.z });
        }
    // Random aftershock in the hardware store (warning first).
    for (const h of sim.map.hazards) {
      if (h.kind !== 'collapse' || this.collapseAt) continue;
      const r = createStateRng(subSeed(sim.seed, `collapse:${h.id}:${day}:${hour}`));
      if (r.chance(sim.cfg.hazards.collapseChancePerHour * sim.diff.hazardDensity)) {
        this.collapseAt = { id: h.id, at: sim.time + sim.cfg.hazards.collapseWarnSec };
        this.warnNear(h, true);
      }
    }
    // Day-30 helicopter window.
    const total = sim.cfg.session.totalDays;
    if (this.heli.phase === 'none' && helicopterWindowOpen(sim.clock, sim.diff, total)) {
      this.heli = {
        phase: 'incoming',
        at: sim.time,
        aliveAtWindow: [...sim.players.values()].filter(
          (p) => p.life === 'alive' || p.life === 'downed' || p.life === 'disconnected',
        ).length,
      };
      this.dirty.heli = true;
      sim.send('all', 'event', { kind: 'heli_incoming' });
    }
  }

  private plannedCrate(day: number): Crate {
    const sim = this.sim;
    const r = createStateRng(subSeed(sim.seed, `supply:${day}`));
    const lp = r.pick(sim.map.lootPoints.filter((l) => l.zone !== 'camp_rooftops'));
    return {
      id: `supply_d${day}`,
      x: lp.x + r.range(-2, 2),
      z: lp.z + r.range(-2, 2),
      zone: lp.zone,
    };
  }

  /** Opens a supply crate: late-game odds (rarer items), double draws. */
  rollCrate(c: Crate) {
    const sim = this.sim;
    const rng = createStateRng(subSeed(sim.seed, `crate:${c.id}`));
    const base = {
      zone: c.zone,
      items: sim.cfg.items,
      diff: sim.diff,
      players: sim.players.size,
      session: sim.cfg.session,
      rng,
    };
    return [...rollLoot({ ...base, day: 30 }), ...rollLoot({ ...base, day: 30 })];
  }

  private dawn() {
    const sim = this.sim;
    // Respawns at camp (Easy keeps the bag but loses 20% of each stat).
    let i = 0;
    for (const p of sim.players.values()) {
      if (p.life === 'dead' && p.pendingRespawn) {
        const spawn = sim.map.spawns[i++ % sim.map.spawns.length]!;
        const pen = deathOutcome(sim.diff).statPenaltyRatio;
        const f = freshStats();
        p.stats = {
          ...f,
          health: f.health * (1 - pen),
          hunger: f.hunger * (1 - pen),
          thirst: f.thirst * (1 - pen),
          warmth: f.warmth * (1 - pen),
          energy: f.energy * (1 - pen),
        };
        p.life = 'alive';
        p.pendingRespawn = false;
        p.bleedOutAt = null;
        p.protectedUntil = sim.time + sim.cfg.session.respawnProtectionSec;
        sim.placeAt(p, spawn.x, spawn.z);
        sim.send('all', 'event', { kind: 'respawned', userId: p.userId });
      }
      p.sleeping = false;
    }
    // Floating debris and some containers refill after a storm night.
    if (sim.storms.includes(sim.clock.day - 1)) this.refillLoot();
  }

  private refillLoot() {
    const sim = this.sim;
    const r = createStateRng(subSeed(sim.seed, `refill:${sim.clock.day}`));
    for (const lp of sim.map.lootPoints) {
      if (!sim.lootOpened.has(lp.id)) continue;
      if (lp.container === 'floating' || r.chance(sim.cfg.events.debrisRespawnRatio)) {
        sim.lootOpened.delete(lp.id);
        sim.dirty.loot.add(lp.id);
      }
    }
    for (const c of sim.map.chopTargets)
      if (c.kind === 'debris') {
        sim.chopsLeft.set(c.id, c.chops);
        sim.dirty.chops.add(c.id);
      }
    sim.send('all', 'event', { kind: 'debris_arrived' });
  }

  /** Storm start: uncovered builds and storage take damage; the open fire goes out. */
  onStormStart() {
    const sim = this.sim;
    const ev = sim.cfg.events;
    if (!sim.camp.structures.has('boat_cover') && this.boat.progress > 0) {
      this.boat.progress = Math.max(0, this.boat.progress - ev.stormBoatProgressLoss);
      this.dirty.boat = true;
      sim.send('all', 'event', { kind: 'storm_damage', target: 'boat' });
    }
    if (!sim.camp.structures.has('storage_cover')) {
      let lost = 0;
      for (const [item, qty] of sim.storage) {
        if (sim.items.get(item)?.category !== 'material') continue;
        const loss = Math.floor(qty * ev.stormStorageLossRatio);
        if (loss > 0) {
          lost += loss;
          if (qty - loss > 0) sim.storage.set(item, qty - loss);
          else sim.storage.delete(item);
        }
      }
      if (lost > 0) {
        sim.dirty.storage = true;
        sim.send('all', 'event', { kind: 'storm_damage', target: 'storage', lost });
      }
    }
    if (sim.fireLit() && !sim.camp.structures.has('shelter')) sim.extinguishFire();
  }

  // ── Build (boat / camp / signal) ──────────────────────────────────────────

  build(uid: string, target: 'boat' | 'camp' | 'signal', action: 'deposit' | 'work') {
    const sim = this.sim;
    const p = sim.players.get(uid);
    if (!sim.canAct(p)) return;
    if (target === 'signal') return this.lightSignalFire(p);
    const atSite =
      target === 'boat' ? inRect(expand(sim.map.boatDock, DOCK_REACH_M), p.x, p.z) : sim.atCamp(p);
    if (!atSite) return sim.deny(uid, 'build', 'not_here');

    const need = target === 'boat' ? this.boatNeeds() : this.campNeeds();
    if (!need) return sim.deny(uid, 'build', 'complete');
    const deposited = target === 'boat' ? this.boat.deposited : this.campUpgrade.deposited;

    if (action === 'deposit') {
      let moved = 0;
      for (const m of need.materials) {
        const missing = m.qty - (deposited.get(m.item) ?? 0);
        const n = Math.min(missing, countItem(p.bag, m.item));
        if (n <= 0) continue;
        sim.setBag(p, removeItem(p.bag, m.item, n)!);
        deposited.set(m.item, (deposited.get(m.item) ?? 0) + n);
        sim.logActivity(uid, 'build', m.item, n);
        moved += n;
      }
      if (!moved) return sim.deny(uid, 'build', 'nothing_to_deposit');
      if (target === 'boat') this.dirty.boat = true;
      else sim.dirty.camp = true;
      return;
    }

    // Work: all materials in, tools in hand, workbench where required.
    if (need.materials.some((m) => (deposited.get(m.item) ?? 0) < m.qty))
      return sim.deny(uid, 'build', 'missing_materials');
    if (need.tools.some((t) => countItem(p.bag, t) < 1))
      return sim.deny(uid, 'build', 'missing_tools');
    if (need.workbench2 && sim.camp.workbenchTier < 2)
      return sim.deny(uid, 'build', 'needs_workbench');
    sim.startChannel(p, {
      kind: 'build',
      target,
      endsAt: Number.POSITIVE_INFINITY,
      x: p.x,
      z: p.z,
    });
  }

  /** Materials still required for the current boat stage (team- and difficulty-scaled). */
  boatNeeds() {
    const sim = this.sim;
    const stage = sim.cfg.boatStages[this.boat.stage];
    if (!stage) return null;
    const save = Math.max(
      ...[...sim.players.values()].map((p) => sim.perk(p, 'materialSaveRatio')),
    );
    const materials = scaledBoatMaterials(stage, sim.diff, sim.players.size, sim.cfg.session).map(
      (m) => ({
        item: m.item,
        qty: MATERIAL_SAVE_ITEMS.has(m.item) ? Math.max(1, Math.ceil(m.qty * (1 - save))) : m.qty,
      }),
    );
    return { materials, tools: stage.tools, workbench2: stage.workbench2, stage: stage.stage };
  }

  campNeeds() {
    const up = this.sim.cfg.campUpgrades[this.sim.camp.level - 1];
    if (!up) return null;
    return { materials: up.materials, tools: [] as string[], workbench2: false, stage: up.level };
  }

  private stopBuilders(target: string) {
    for (const p of this.sim.players.values())
      if (p.channel?.kind === 'build' && p.channel.target === target) p.channel = null;
  }

  private completeBoatStage() {
    const sim = this.sim;
    this.boat.stage += 1;
    this.boat.progress = 0;
    this.boat.deposited.clear();
    this.dirty.boat = true;
    for (const p of sim.players.values())
      if (p.channel?.kind === 'build' && p.channel.target === 'boat') {
        p.boatStagesBuilt += 1;
        sim.learn(p.userId, 'built_boat_stage', true);
      }
    this.stopBuilders('boat');
    sim.send('all', 'event', { kind: 'boat_stage', stage: this.boat.stage });
  }

  private completeCampUpgrade() {
    const sim = this.sim;
    const up = sim.cfg.campUpgrades[sim.camp.level - 1]!;
    sim.camp.level = up.level;
    sim.camp.workbenchTier = Math.max(sim.camp.workbenchTier, up.workbenchTier);
    this.campUpgrade.progress = 0;
    this.campUpgrade.deposited.clear();
    sim.dirty.camp = true;
    this.stopBuilders('camp');
    sim.send('all', 'event', { kind: 'camp_level', level: sim.camp.level });
  }

  private lightSignalFire(p: SimPlayer) {
    const sim = this.sim;
    const s = sim.map.signalSpot;
    if (Math.hypot(p.x - s.x, p.z - s.z) > s.r + 1) return sim.deny(p.userId, 'build', 'not_here');
    if (!sim.camp.structures.has('signal_fire'))
      return sim.deny(p.userId, 'build', 'no_signal_fire');
    if (sim.clock.day < sim.cfg.session.totalDays) return sim.deny(p.userId, 'build', 'too_early');
    if (countItem(p.bag, 'lighter') + countItem(p.bag, 'torch') < 1)
      return sim.deny(p.userId, 'build', 'missing_tools');
    if (this.signal.fireLit) return;
    this.signal.fireLit = true;
    this.dirty.heli = true;
    sim.learn(p.userId, 'lit_signal_fire', true);
    sim.send('all', 'event', { kind: 'signal_active', by: 'fire' });
  }

  /** Mirror / flare / whistle: counts as a signal at the rescue point while the helicopter is near. */
  useSignalItem(p: SimPlayer, item: string): boolean {
    const sim = this.sim;
    if (!SIGNAL_ITEMS.has(item)) return false;
    const rp = sim.map.rescuePoint;
    const near = Math.hypot(p.x - rp.x, p.z - rp.z) <= rp.r * 2;
    if (this.heli.phase !== 'incoming' || !near || !sim.camp.structures.has('sos_sign')) {
      sim.deny(p.userId, 'use', 'no_one_to_signal');
      return true;
    }
    if (item === 'flare') sim.setBag(p, removeItem(p.bag, 'flare', 1)!);
    if (!this.signal.sosFlashed) {
      this.signal.sosFlashed = true;
      this.dirty.heli = true;
      sim.learn(p.userId, 'signaled_rescuers', true);
      sim.send('all', 'event', { kind: 'signal_active', by: item });
    }
    return true;
  }

  signalActive() {
    return this.signal.fireLit || this.signal.sosFlashed;
  }

  // ── Interactions ──────────────────────────────────────────────────────────

  interact(p: SimPlayer, kind: string, id: string): boolean {
    const sim = this.sim;
    if (kind === 'npc') {
      const n = this.npcs.get(id);
      if (!n || n.state !== 'waiting') return (sim.deny(p.userId, 'interact', 'gone'), true);
      if (dist2(p, n) > 2.5) return (sim.deny(p.userId, 'interact', 'too_far'), true);
      // Help first: share food or water, then they follow you to camp.
      const gift = p.bag.find((s) => {
        const c = s && sim.items.get(s.item)?.category;
        return c === 'food' || (c === 'water' && s!.item !== 'dirty_water');
      });
      if (!gift) return (sim.deny(p.userId, 'interact', 'needs_food_or_water'), true);
      sim.setBag(p, removeItem(p.bag, gift.item, 1)!);
      n.state = 'following';
      n.followUserId = p.userId;
      this.dirty.npcs = true;
      sim.learn(p.userId, 'helped_survivor', true);
      sim.send('all', 'event', { kind: 'survivor_following', id: n.id, userId: p.userId });
      return true;
    }
    if (kind === 'boat') return (this.launchBoat(p), true);
    if (kind === 'sleep') {
      const ok =
        sim.atCamp(p) &&
        sim.camp.structures.has('shelter') &&
        (sim.dayPhase === 'night' || sim.dayPhase === 'dusk') &&
        sim.weather !== 'storm';
      if (!ok) return (sim.deny(p.userId, 'interact', 'cannot_sleep'), true);
      p.sleeping = true;
      sim.send('all', 'event', { kind: 'sleeping', userId: p.userId });
      return true;
    }
    return false;
  }

  private rescueNpc(n: Npc, p: SimPlayer) {
    const sim = this.sim;
    n.state = 'rescued';
    n.followUserId = null;
    this.counters.npcsRescued += 1;
    this.dirty.npcs = true;
    // Thank-you gift: a rare item (seeded per survivor).
    const rares = sim.cfg.items.filter((i) => i.rarity === 'rare');
    if (rares.length) {
      const it = createStateRng(subSeed(sim.seed, `gift:${n.id}`)).pick(rares);
      sim.give(p, it.key, 1);
      sim.send(p.userId, 'toast', { key: 'survivor_gift', item: it.key });
    }
    sim.send('all', 'event', { kind: 'survivor_rescued', id: n.id, userId: p.userId });
  }

  private checkSurvivorTimeouts() {
    const sim = this.sim;
    const now = absMinutes(sim.clock);
    for (const n of this.npcs.values())
      if (
        n.state === 'waiting' &&
        n.spottedAt !== null &&
        now - n.spottedAt > sim.cfg.events.survivorWaitDays * MINUTES_PER_DAY
      ) {
        n.state = 'evacuated';
        this.dirty.npcs = true;
        sim.send('all', 'event', { kind: 'survivor_evacuated', id: n.id });
      }
  }

  // ── Downed / revive / death ───────────────────────────────────────────────

  /** Applies damage (respects respawn protection). */
  hurt(p: SimPlayer, dmg: number, cause: string) {
    const sim = this.sim;
    if (p.life !== 'alive' || sim.time < p.protectedUntil || dmg <= 0) return;
    p.stats = { ...p.stats, health: Math.max(0, p.stats.health - dmg) };
    sim.send(p.userId, 'hurt', { cause, dmg });
    if (p.stats.health <= 0) this.down(p);
  }

  down(p: SimPlayer) {
    const sim = this.sim;
    if (p.life !== 'alive') return;
    p.life = 'downed';
    p.bleedOutAt = sim.time + sim.diff.bleedOutSec;
    p.channel = null;
    p.sleeping = false;
    sim.send('all', 'event', { kind: 'downed', userId: p.userId, bleedOutAt: p.bleedOutAt });
    this.cancelRevivesOn(p.userId);
  }

  /** `revive` message: teammate revive, or solo Second Wind on yourself. */
  revive(uid: string, targetUserId: string) {
    const sim = this.sim;
    const p = sim.players.get(uid);
    const t = sim.players.get(targetUserId);
    if (!p || !t || t.life !== 'downed' || sim.paused) return;
    const item =
      countItem(p.bag, 'first_aid_kit') > 0
        ? 'first_aid_kit'
        : countItem(p.bag, 'bandage') > 0
          ? 'bandage'
          : null;
    if (!item) return sim.deny(uid, 'revive', 'needs_bandage');
    if (p === t) {
      if (!sim.solo) return sim.deny(uid, 'revive', 'needs_teammate');
      if (this.secondWindsUsed >= sim.diff.secondWinds)
        return sim.deny(uid, 'revive', 'no_second_winds');
      const secs = reviveSeconds(sim.cfg.session, p.role, true);
      p.channel = { kind: 'revive', target: uid, endsAt: sim.time + secs, x: p.x, z: p.z };
      sim.send(uid, 'channel', { kind: 'revive', target: uid, endsAt: p.channel.endsAt });
      return;
    }
    if (p.life !== 'alive') return;
    if (dist2(p, t) > REVIVE_RANGE_M) return sim.deny(uid, 'revive', 'too_far');
    const base = reviveSeconds(sim.cfg.session, p.role === 'medic' ? 'medic' : 'other', false);
    // Solo-perk / role multipliers beyond the Medic's own (config) seconds.
    const secs = p.role === 'medic' ? base : base / sim.perk(p, 'reviveSpeedMul');
    sim.startChannel(p, {
      kind: 'revive',
      target: targetUserId,
      endsAt: sim.time + secs,
      x: p.x,
      z: p.z,
    });
  }

  completeRevive(p: SimPlayer, targetUserId: string) {
    const sim = this.sim;
    const t = sim.players.get(targetUserId);
    if (!t || t.life !== 'downed') return;
    const self = p === t;
    if (!self && p.life !== 'alive') return;
    const item =
      countItem(p.bag, 'first_aid_kit') > 0
        ? 'first_aid_kit'
        : countItem(p.bag, 'bandage') > 0
          ? 'bandage'
          : null;
    if (!item) return sim.deny(p.userId, 'revive', 'needs_bandage');
    sim.setBag(p, removeItem(p.bag, item, 1)!);
    t.life = 'alive';
    t.bleedOutAt = null;
    t.stats = {
      ...t.stats,
      health: reviveHealth(item),
      effects: t.stats.effects.filter((e) => e !== 'open_wound'),
    };
    t.protectedUntil = sim.time + sim.cfg.session.respawnProtectionSec;
    t.last = { x: t.x, y: t.y, z: t.z, t: null, at: sim.time };
    t.minOffset = null;
    if (self) {
      this.secondWindsUsed += 1;
      sim.send('all', 'event', {
        kind: 'second_wind',
        userId: p.userId,
        left: sim.diff.secondWinds - this.secondWindsUsed,
      });
    } else {
      p.revivesGiven += 1;
      sim.learn(p.userId, 'revived_teammate', true);
      sim.send('all', 'event', { kind: 'revived', userId: t.userId, by: p.userId });
    }
  }

  private cancelRevivesOn(targetUserId: string) {
    for (const p of this.sim.players.values())
      if (
        p.channel?.kind === 'revive' &&
        p.channel.target === targetUserId &&
        p.userId !== targetUserId
      )
        this.sim.cancelChannel(p, 'target_changed');
  }

  private die(p: SimPlayer) {
    const sim = this.sim;
    const out = deathOutcome(sim.diff);
    p.life = 'dead';
    p.bleedOutAt = null;
    p.channel = null;
    p.deaths += 1;
    this.counters.deaths += 1;
    this.cancelRevivesOn(p.userId);
    // Escorted survivors wait where they are.
    for (const n of this.npcs.values())
      if (n.followUserId === p.userId) {
        n.state = 'waiting';
        n.followUserId = null;
        this.dirty.npcs = true;
      }
    if (out.bag === 'drop_at_death_spot') {
      const expires = absMinutes(sim.clock) + sim.cfg.events.droppedBagDays * MINUTES_PER_DAY;
      for (const s of p.bag)
        if (s) sim.spawnDrop({ ...s, x: p.x, z: p.z, expiresAtMin: expires, fromBagOf: p.userId });
      sim.setBag(
        p,
        p.bag.map(() => null),
      );
      p.equip = { hand: null, body: null, feet: null };
    }
    p.pendingRespawn = out.respawnAtDawn;
    p.spectator = out.spectator;
    sim.send('all', 'event', { kind: 'died', userId: p.userId, spectator: out.spectator });

    // Everyone down at once?
    const present = [...sim.players.values()].filter(
      (x) => x.life !== 'disconnected' && !x.rescued,
    );
    if (present.length && present.every((x) => x.life === 'dead' || x.life === 'downed')) {
      if (allDeadOutcome(sim.difficulty) === 'run_lost') return this.end();
      for (const x of present)
        if (x.life === 'downed') {
          x.life = 'dead';
          x.bleedOutAt = null;
          x.pendingRespawn = true;
        }
      this.boat.progress = Math.max(0, this.boat.progress - sim.cfg.events.allDeadBoatProgressLoss);
      this.dirty.boat = true;
      sim.send('all', 'event', { kind: 'all_down' });
    }
    if (sim.difficulty === 'hard' && [...sim.players.values()].every((x) => x.spectator))
      this.end();
  }

  // ── Hazards (always warned before they hurt) ──────────────────────────────

  private warnNear(h: HazardZone, force = false) {
    const sim = this.sim;
    const zone = expand(h.rect, sim.cfg.hazards.warnRadiusM);
    for (const p of sim.players.values()) {
      if (p.life !== 'alive' || !inRect(zone, p.x, p.z)) continue;
      const k = `warn:${h.id}`;
      if (!force && sim.time - (p.lastAt[k] ?? -Infinity) < WARN_THROTTLE_SEC) continue;
      p.lastAt[k] = sim.time;
      sim.send(p.userId, 'hazard:warn', { id: h.id, kind: h.kind });
    }
  }

  private hazardHit(p: SimPlayer, h: HazardZone, learning: string) {
    this.counters.hazardHits += 1;
    this.sim.learn(p.userId, learning, false);
    this.sim.send(p.userId, 'hazard:hit', { id: h.id, kind: h.kind });
  }

  private hazards(minutes: number) {
    const sim = this.sim;
    const hz = sim.cfg.hazards;
    const density = sim.diff.hazardDensity;
    const night = sim.dayPhase === 'night';
    for (const h of sim.map.hazards) {
      if (h.when === 'night' && !night) continue;
      if (h.kind !== 'collapse') this.warnNear(h);
      for (const p of sim.players.values()) {
        if (
          p.life !== 'alive' ||
          p.onBoat ||
          sim.time < p.protectedUntil ||
          !inRect(h.rect, p.x, p.z)
        )
          continue;
        const wet = depthBand(depthAt(sim.map, p.x, p.z, sim.waterLevel)) !== 'dry';
        const r = createStateRng(
          subSeed(sim.seed, `hz:${h.id}:${p.userId}:${Math.floor(sim.time)}`),
        );
        const inside = `in:${h.id}`;
        const firstEntry = !p.lastAt[inside] || sim.time - p.lastAt[inside]! > 3;
        p.lastAt[inside] = sim.time;
        switch (h.kind) {
          case 'live_wire':
            if (wet && hz.liveWireLethal) {
              this.hazardHit(p, h, 'entered_live_wire_water');
              this.hurt(p, p.stats.health, 'live_wire');
            }
            break;
          case 'current':
            if (depthBand(depthAt(sim.map, p.x, p.z, sim.waterLevel)) === 'swim') {
              if (firstEntry) this.hazardHit(p, h, 'swam_in_current');
              this.hurt(p, hz.currentHealthPerMin * minutes * (night ? 1.5 : 1), 'current');
              p.stats = { ...p.stats, energy: Math.max(0, p.stats.energy - minutes) };
            }
            break;
          case 'rats':
            if (
              wet &&
              sim.time >= p.scaredUntil &&
              r.chance(hz.ratBiteChancePerMin * density * minutes)
            ) {
              if (p.equip.feet === 'boots') sim.learn(p.userId, 'boots_prevented_bite', true);
              else {
                this.hazardHit(p, h, 'rat_bite');
                this.addEffect(p, 'open_wound');
              }
            }
            break;
          case 'snake':
            if (
              wet &&
              sim.time >= p.scaredUntil &&
              r.chance(hz.snakeBiteChancePerMin * density * minutes)
            ) {
              this.hazardHit(p, h, 'snake_bite');
              this.hurt(p, hz.snakeDamage, 'snake');
            }
            break;
          case 'collapse':
            break;
        }
      }
    }
  }

  private collapse(id: string) {
    const sim = this.sim;
    this.collapseAt = null;
    const h = sim.map.hazards.find((x) => x.id === id);
    if (!h) return;
    sim.send('all', 'event', { kind: 'collapse', id });
    for (const p of sim.players.values()) {
      if (p.life !== 'alive' || !inRect(h.rect, p.x, p.z) || sim.time < p.protectedUntil) continue;
      this.hazardHit(p, h, 'stayed_in_collapsing_building');
      this.addEffect(p, 'open_wound');
      this.hurt(p, sim.cfg.hazards.collapseDamage, 'collapse');
    }
  }

  /** Axe/shove inside a critter zone scares rats/snakes away for a while. */
  scareCritters(p: SimPlayer) {
    const sim = this.sim;
    const h = sim.map.hazards.find(
      (x) => (x.kind === 'rats' || x.kind === 'snake') && inRect(expand(x.rect, 2), p.x, p.z),
    );
    if (!h) return false;
    p.scaredUntil = sim.time + sim.cfg.hazards.critterScareSec;
    sim.send(p.userId, 'toast', { key: 'critters_scared', kind: h.kind });
    return true;
  }

  addEffect(p: SimPlayer, effect: 'open_wound' | 'stomach_illness' | 'infection') {
    if (p.stats.effects.includes(effect)) return;
    p.stats = { ...p.stats, effects: [...p.stats.effects, effect] };
    if (effect !== 'open_wound') this.counters.sicknessEvents += 1;
    this.sim.send(p.userId, 'effect', { effect, on: true });
  }

  private expireDrops() {
    const sim = this.sim;
    const now = absMinutes(sim.clock);
    for (const [id, d] of sim.drops)
      if (d.expiresAtMin !== undefined && d.expiresAtMin <= now) {
        sim.drops.delete(id);
        sim.dirty.drops = true;
      }
  }

  // ── Day 30: boat trip, helicopter, ending ─────────────────────────────────

  private launchBoat(p: SimPlayer) {
    const sim = this.sim;
    if (this.boat.stage < sim.cfg.boatStages.length)
      return sim.deny(p.userId, 'interact', 'boat_not_ready');
    if (this.heli.phase === 'none') return sim.deny(p.userId, 'interact', 'too_early');
    if (this.boatTrip) return sim.deny(p.userId, 'interact', 'boat_gone');
    const dock = expand(sim.map.boatDock, DOCK_REACH_M);
    if (!inRect(dock, p.x, p.z)) return sim.deny(p.userId, 'interact', 'not_here');
    const riders = [...sim.players.values()].filter(
      (x) => x.life === 'alive' && inRect(dock, x.x, x.z),
    );
    for (const r of riders) {
      r.onBoat = true;
      r.channel = null;
    }
    this.boatTrip = {
      departAt: sim.time,
      arriveAt: sim.time + sim.cfg.events.boatTravelSec,
      riders: riders.map((r) => r.userId),
    };
    this.dirty.heli = true;
    sim.send('all', 'event', { kind: 'boat_departed', riders: this.boatTrip.riders });
  }

  private tickBoatTrip() {
    const sim = this.sim;
    const trip = this.boatTrip;
    if (!trip || !trip.riders.length) return;
    const from = sim.map.boatDock;
    const to = sim.map.rescuePoint;
    const k = Math.min(1, (sim.time - trip.departAt) / (trip.arriveAt - trip.departAt));
    trip.riders.forEach((uid, i) => {
      const r = sim.players.get(uid);
      if (!r || !r.onBoat) return;
      const off = (i - (trip.riders.length - 1) / 2) * 1.2;
      sim.placeAt(
        r,
        from.x + (to.x - from.x) * k + off,
        from.z + (to.z - from.z) * k,
        sim.waterLevel,
      );
      if (k >= 1) r.onBoat = false;
    });
    if (k >= 1) {
      trip.riders = [];
      sim.send('all', 'event', { kind: 'boat_arrived' });
    }
  }

  private atRescuePoint(p: SimPlayer) {
    const rp = this.sim.map.rescuePoint;
    return Math.hypot(p.x - rp.x, p.z - rp.z) <= rp.r;
  }

  private tickHelicopter() {
    const sim = this.sim;
    const h = this.heli;
    if (h.phase === 'none' || h.phase === 'done') return;
    const waiting = () =>
      [...sim.players.values()].filter(
        (p) => p.life === 'alive' && !p.rescued && !p.onBoat && this.atRescuePoint(p),
      );
    if (h.phase === 'incoming' && this.signalActive() && waiting().length) {
      h.phase = 'arriving';
      h.at = sim.time + sim.cfg.events.heliArriveSec;
      this.dirty.heli = true;
      sim.send('all', 'event', { kind: 'heli_arriving', at: h.at });
    } else if ((h.phase === 'arriving' || h.phase === 'lifting') && sim.time >= h.at) {
      h.phase = 'lifting';
      const next = waiting()[0];
      if (next) {
        next.rescued = true;
        next.channel = null;
        sim.learn(next.userId, 'rescued', true);
        sim.send('all', 'event', { kind: 'lifted', userId: next.userId });
      }
      h.at = sim.time + sim.cfg.events.heliLiftSecPerPlayer;
      this.dirty.heli = true;
    }
    const stillOut = [...sim.players.values()].filter(
      (p) =>
        !p.rescued &&
        (p.life === 'alive' ||
          p.life === 'downed' ||
          p.life === 'disconnected' ||
          (p.life === 'dead' && !p.spectator)),
    );
    if (h.phase === 'lifting' && stillOut.length === 0) return this.end();
    if (helicopterWindowOver(sim.clock, sim.diff, sim.cfg.session.totalDays)) this.end();
  }

  /** Computes the ending + score once; the room persists and broadcasts it. */
  end() {
    const sim = this.sim;
    if (this.result) return;
    this.heli.phase = 'done';
    const players = [...sim.players.values()];
    const rescued = players.filter((p) => p.rescued).length;
    const learning: RunResult['learning'] = {};
    let good = 0;
    for (const l of sim.learningLog) {
      const e = (learning[l.eventKey] ??= { good: 0, bad: 0 });
      if (l.isPositive) {
        e.good += 1;
        good += 1;
      } else e.bad += 1;
    }
    const summary: RunSummary = {
      daysSurvived: Math.min(sim.clock.day, sim.cfg.session.totalDays),
      boatStagesCompleted: this.boat.stage,
      playersRescued: rescued,
      npcsRescued: this.counters.npcsRescued,
      campLevel: sim.camp.level,
      goodActions: good,
      deaths: this.counters.deaths,
      hazardHits: this.counters.hazardHits,
      sicknessEvents: this.counters.sicknessEvents,
      ending: decideEnding({
        rescued,
        aliveAtWindow: Math.max(1, this.heli.aliveAtWindow || players.length),
        boatComplete: this.boat.stage >= sim.cfg.boatStages.length,
        signalActive: this.signalActive(),
      }),
    };
    const score = survivalScore(summary, sim.cfg.scoring, sim.diff);
    const perPlayer: RunResult['perPlayer'] = {};
    for (const p of players) {
      const mine = sim.learningLog.filter((l) => l.userId === p.userId);
      perPlayer[p.userId] = {
        rescued: p.rescued,
        deaths: p.deaths,
        revivesGiven: p.revivesGiven,
        good: mine.filter((l) => l.isPositive).length,
        risky: mine.filter((l) => !l.isPositive).length,
      };
    }
    this.result = {
      ending: summary.ending,
      score: score.final,
      baseScore: score.base,
      summary,
      perPlayer,
      learning,
    };
    sim.send('all', 'ended', { ...this.result });
  }

  /** Ground height helper for placing players/NPCs. */
  groundAt(x: number, z: number) {
    return groundAt(this.sim.map, x, z);
  }

  /** Adds an item to a bag (used by tests/admin tools). */
  grant(p: SimPlayer, item: string, qty: number) {
    const r = addItem(p.bag, item, qty, this.sim.items);
    this.sim.setBag(p, r.bag);
  }
}
