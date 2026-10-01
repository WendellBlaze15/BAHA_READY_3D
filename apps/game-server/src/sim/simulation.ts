import {
  BARANGAY_1,
  JUMP_APEX_M,
  addItem,
  advanceClock,
  applyCraft,
  bagWeight,
  canCraft,
  countItem,
  createStateRng,
  depthAt,
  depthBand,
  dist2,
  emptyBag,
  freshStats,
  groundAt,
  inRect,
  indexItems,
  initialSprintState,
  isHotHours,
  moveSlot,
  phaseAt,
  removeItem,
  resolveSwing,
  rollLoot,
  setSprintIntent,
  splitSlot,
  sprintLocked,
  stepSprint,
  stormSchedule,
  subSeed,
  tickStats,
  tryJump,
  validateMove,
  wearTool,
  type Bag,
  type ClientMessage,
  type Clock,
  type DayPhase,
  type DifficultyConfig,
  type ItemDef,
  type ItemIndex,
  type MeleeTarget,
  type StateRng,
  type StatusEffect,
  type SurvivalConfig,
  type SurvivalMap,
} from '@baha/shared/survival';
import type {
  ActivityEntry,
  Channel,
  Dirty,
  LearningEvent,
  Outbound,
  SimPlayer,
  Weather,
} from './types.ts';

/** Interaction reach (m): loot, drops, storage, giving, healing. */
export const INTERACT_RANGE_M = 2.5;
export const GIVE_RANGE_M = 3;
/** Moving farther than this from where a hold started cancels it. */
const CHANNEL_CANCEL_M = 0.75;
/** Movement violations within this window before the run is flagged for review. */
const VIOLATION_WINDOW_SEC = 30;
const VIOLATION_FLAG_COUNT = 10;
/** How far (s) a client clock may run ahead of the server before samples are clamped. */
const CLIENT_AHEAD_SLACK_SEC = 0.25;
/** Max rate the clock baseline may move earlier (s per s) — bounds clock-speed cheats to 5%. */
const CLOCK_DRIFT_RATE = 0.05;
/** Stats are advanced in 1 s steps (in-game minutes vary by difficulty). */
const STAT_STEP_SEC = 1;
/** Campfire burn time per build (in-game minutes). */
const FIRE_BURN_MIN = 8 * 60;
const NEAR_FIRE_M = 4;
const GIVE_OFFER_SEC = 15;
const MAX_DROPS = 300;
/** Structures that exist once per camp (the campfire can be rebuilt after it burns out). */
const UNIQUE_STRUCTURES = new Set([
  'shelter',
  'rain_catcher',
  'storage_cover',
  'signal_fire',
  'sos_sign',
  'boat_cover',
]);

export interface SimOptions {
  config: SurvivalConfig;
  difficulty: 'easy' | 'normal' | 'hard';
  seed: number;
  solo: boolean;
  players: { userId: string; username: string; role: string }[];
  map?: SurvivalMap;
}

interface Drop {
  item: string;
  qty: number;
  durability?: number;
  x: number;
  z: number;
}

interface GiveOffer {
  id: string;
  from: string;
  to: string;
  slot: number;
  item: string;
  expiresAt: number;
}

/**
 * Authoritative Survival simulation (Sections 6–9, 18.3). Pure TypeScript — no networking —
 * so every rule is unit-testable. The room calls the intent methods with VALIDATED payloads
 * and the verified user id, runs `tick()` at 20 Hz, then drains `out` and mirrors `dirty`
 * into the synced state.
 */
export class Simulation {
  readonly cfg: SurvivalConfig;
  readonly diff: DifficultyConfig;
  readonly difficulty: 'easy' | 'normal' | 'hard';
  readonly map: SurvivalMap;
  readonly items: ItemIndex;
  readonly solo: boolean;
  readonly seed: number;
  readonly rng: StateRng;

  /** Simulation seconds since start (drives cooldowns, holds and throttles). */
  time = 0;
  clock: Clock;
  dayPhase: DayPhase;
  weather: Weather = 'clear';
  waterLevel: number;
  paused = false;
  readonly storms: number[];

  readonly players = new Map<string, SimPlayer>();
  readonly lootOpened = new Set<string>();
  readonly drops = new Map<string, Drop>();
  readonly chopsLeft = new Map<string, number>();
  readonly storage = new Map<string, number>();
  readonly camp = { structures: new Set<string>(), fireMinutesLeft: 0, workbenchTier: 1, level: 1 };
  readonly activity: ActivityEntry[] = [];
  readonly learning: LearningEvent[] = [];
  /** Run flags for admin review (e.g. repeated movement violations). */
  readonly flags = new Set<string>();

  out: Outbound[] = [];
  dirty: Dirty = {
    loot: new Set(),
    drops: false,
    chops: new Set(),
    storage: false,
    camp: false,
    bags: new Set(),
  };

  private statAcc = 0;
  private dropSeq = 0;
  private offerSeq = 0;
  private offers = new Map<string, GiveOffer>();
  private lastHour = -1;

  constructor(o: SimOptions) {
    this.cfg = o.config;
    this.difficulty = o.difficulty;
    this.diff = o.config.difficulties[o.difficulty];
    this.map = o.map ?? BARANGAY_1;
    this.items = indexItems(o.config.items);
    this.solo = o.solo;
    this.seed = o.seed >>> 0;
    this.rng = createStateRng(subSeed(this.seed, 'world'));
    this.clock = { day: 1, minute: o.config.session.startHour * 60 };
    this.dayPhase = phaseAt(this.clock.minute, o.config.session);
    this.waterLevel = this.map.baseWaterLevel;
    this.storms = stormSchedule(
      this.diff,
      o.config.session.totalDays,
      createStateRng(subSeed(this.seed, 'storms')),
    );
    for (const c of this.map.chopTargets) this.chopsLeft.set(c.id, c.chops);
    o.players.forEach((p, i) => this.addPlayer(p, i));
    this.updateWeather();
  }

  // ── Players ──────────────────────────────────────────────────────────────

  addPlayer(p: { userId: string; username: string; role: string }, index = this.players.size) {
    const spawn = this.map.spawns[index % this.map.spawns.length]!;
    const y = groundAt(this.map, spawn.x, spawn.z);
    const sp: SimPlayer = {
      ...p,
      x: spawn.x,
      y,
      z: spawn.z,
      rotY: 0,
      anim: 'idle',
      life: 'alive',
      stats: freshStats(),
      sprint: initialSprintState(),
      bag: emptyBag(this.cfg.bag),
      equip: { hand: null, body: null, feet: null },
      last: { x: spawn.x, y, z: spawn.z, t: null, at: this.time },
      minOffset: null,
      offsetAt: 0,
      speed: 0,
      movedAt: -1,
      violations: [],
      lastSwingAt: -Infinity,
      channel: null,
      lastAt: {},
    };
    this.players.set(p.userId, sp);
    this.dirty.bags.add(p.userId);
    return sp;
  }

  /** Role perk value; solo players get every perk at reduced strength (Section 11). */
  perk<K extends keyof SurvivalConfig['roles']['medic']>(p: SimPlayer, key: K): number {
    const roles = this.cfg.roles;
    if (p.role === 'solo') {
      const best = Math.max(...Object.values(roles).map((r) => r[key] as number));
      const neutral =
        key === 'materialSaveRatio' || key === 'lootHighlightRadiusM' || key === 'earlyWarningMin'
          ? 0
          : 1;
      return neutral + (best - neutral) * this.cfg.session.soloPerkStrength;
    }
    const r = roles[p.role as keyof typeof roles];
    return (r?.[key] as number | undefined) ?? (key === 'materialSaveRatio' ? 0 : 1);
  }

  private send(to: string | 'all', type: string, payload: Record<string, unknown> = {}) {
    this.out.push({ to, type, payload });
  }

  private deny(uid: string, action: string, reason: string) {
    this.send(uid, 'action:denied', { action, reason });
  }

  private canAct(p: SimPlayer | undefined): p is SimPlayer {
    return !!p && p.life === 'alive' && !this.paused;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  tick(dt: number) {
    this.time += dt;
    for (const p of this.players.values()) this.stepPlayerStamina(p, dt);
    this.completeChannels();
    this.expireOffers();
    if (this.paused) return;

    this.statAcc += dt;
    if (this.statAcc < STAT_STEP_SEC) return;
    const step = this.statAcc;
    this.statAcc = 0;

    const prevPhase = this.dayPhase;
    const adv = advanceClock(this.clock, step, this.diff, this.cfg.session);
    this.clock = adv.clock;
    this.dayPhase = phaseAt(this.clock.minute, this.cfg.session);
    if (this.dayPhase !== prevPhase)
      this.send('all', 'event', { kind: `phase_${this.dayPhase}`, day: this.clock.day });
    if (adv.crossedDawn) this.send('all', 'event', { kind: 'dawn', day: this.clock.day });
    this.updateWeather();
    if (this.camp.fireMinutesLeft > 0) {
      this.camp.fireMinutesLeft = Math.max(0, this.camp.fireMinutesLeft - adv.minutesElapsed);
      if (this.camp.fireMinutesLeft === 0) {
        this.camp.structures.delete('campfire');
        this.dirty.camp = true;
        this.send('all', 'event', { kind: 'fire_out' });
      }
    }
    for (const p of this.players.values()) this.stepStats(p, adv.minutesElapsed);
  }

  private stepPlayerStamina(p: SimPlayer, dt: number) {
    if (p.life !== 'alive') return;
    const locked = sprintLocked(p.stats);
    if (locked && p.sprint.want) p.sprint = setSprintIntent(p.sprint, false);
    const moving = this.time - p.movedAt < 0.5 && p.speed > 0.3;
    p.sprint = stepSprint(p.sprint, dt, this.cfg.actions, { moving }).state;
  }

  private stepStats(p: SimPlayer, minutes: number) {
    if (p.life !== 'alive' || minutes <= 0) return;
    const band = depthBand(depthAt(this.map, p.x, p.z, this.waterLevel));
    const atCamp = inRect(this.map.camp, p.x, p.z);
    const { stats, events } = tickStats(
      p.stats,
      minutes,
      {
        night: this.dayPhase === 'night',
        hot: isHotHours(this.clock.minute),
        raining: this.weather !== 'clear',
        inWater: band !== 'dry',
        nearFire: this.fireLit() && dist2(p, this.map.campFire) <= NEAR_FIRE_M,
        sheltered: atCamp && this.camp.structures.has('shelter'),
        sleeping: false,
        wearingBoots: p.equip.feet === 'boots',
        wearingRaincoat: p.equip.body === 'raincoat',
        storm: this.weather === 'storm',
      },
      this.cfg.stats,
      this.diff,
    );
    p.stats = stats;
    for (const e of events) {
      if (e.type === 'effect_added') {
        this.send(p.userId, 'effect', { effect: e.effect, on: true });
        if (e.effect === 'infection') this.learn(p.userId, 'got_leptospirosis_risk', false);
        if (e.effect === 'hypothermia') this.learn(p.userId, 'got_hypothermia', false);
      } else if (e.type === 'effect_removed') {
        this.send(p.userId, 'effect', { effect: e.effect, on: false });
      } else if (e.type === 'health_zero') {
        // Phase 6 adds bleed-out, revive and death rules on top of this state.
        p.life = 'downed';
        p.channel = null;
        this.send('all', 'event', { kind: 'downed', userId: p.userId });
      }
    }
  }

  fireLit() {
    return this.camp.fireMinutesLeft > 0;
  }

  /** Hourly weather (seeded): storm nights from the schedule, otherwise a chance of rain. */
  private updateWeather() {
    const hour = Math.floor(this.clock.minute / 60);
    const key = this.clock.day * 24 + hour;
    if (key === this.lastHour) return;
    this.lastHour = key;
    const s = this.cfg.session;
    const stormNight =
      (this.storms.includes(this.clock.day) && hour >= s.nightStartHour - 1) ||
      (this.storms.includes(this.clock.day - 1) && hour < s.dawnHour);
    let next: Weather;
    if (stormNight) next = 'storm';
    else {
      const r = createStateRng(subSeed(this.seed, `rain:${this.clock.day}:${hour}`));
      next =
        this.weather === 'rain'
          ? r.chance(0.6)
            ? 'rain'
            : 'clear'
          : r.chance(0.12)
            ? 'rain'
            : 'clear';
    }
    if (next === this.weather) return;
    const was = this.weather;
    this.weather = next;
    if (next === 'storm') {
      this.waterLevel += this.diff.waterRisePerStorm;
      this.send('all', 'event', {
        kind: 'storm_started',
        day: this.clock.day,
        waterLevel: this.waterLevel,
      });
    } else if (was === 'storm')
      this.send('all', 'event', { kind: 'storm_ended', day: this.clock.day });
  }

  // ── Movement & actions ───────────────────────────────────────────────────

  move(uid: string, m: ClientMessage<'move'>) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const clientSec = m.t / 1000;
    if (p.last.t !== null && clientSec <= p.last.t) return; // stale / out of order
    // Clock baseline (server − client): fixed at the first sample, then allowed to drift down
    // only slowly (lower latency / clock catch-up). A client clock that races ahead therefore
    // cannot claim more elapsed time than the server has seen (+ a small slack).
    const offset = this.time - clientSec;
    if (p.minOffset === null) p.minOffset = offset;
    else {
      const floor = p.minOffset - CLOCK_DRIFT_RATE * Math.max(0, this.time - p.offsetAt);
      p.minOffset = Math.max(floor, Math.min(p.minOffset, offset));
    }
    p.offsetAt = this.time;
    const t = Math.min(clientSec, this.time - p.minOffset + CLIENT_AHEAD_SLACK_SEC);
    const prevT = p.last.t ?? t - (this.time - p.last.at + CLIENT_AHEAD_SLACK_SEC);

    const wantSprint = m.sprinting && !sprintLocked(p.stats);
    p.sprint = setSprintIntent(p.sprint, wantSprint);
    // Sprint speed is allowed while the server's stamina says sprinting, or would start now
    // (the client starts a frame before our tick sees the intent).
    const a = this.cfg.actions;
    const sprintOk =
      p.sprint.sprinting ||
      (wantSprint && !p.sprint.exhausted && p.sprint.stamina >= a.sprintMinStartStamina);
    const weight = bagWeight(p.bag, this.items);
    const verdict = validateMove(
      { x: p.last.x, y: p.last.y, z: p.last.z, t: prevT },
      { x: m.x, y: m.y, z: m.z, t },
      {
        map: this.map,
        waterLevel: this.waterLevel,
        actions: a,
        bag: this.cfg.bag,
        carryRatio: weight / this.cfg.bag.maxWeightKg,
        sprinting: sprintOk,
        onRaft: false,
        swimSpeedMul: this.perk(p, 'swimSpeedMul'),
      },
    );
    p.rotY = m.rotY;
    if (!verdict.ok) {
      this.violation(p, verdict.reason);
      return;
    }
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    const dt = Math.max(1e-3, t - prevT);
    p.speed = d / dt;
    if (d > 0.01) p.movedAt = this.time;
    p.x = m.x;
    p.y = m.y;
    p.z = m.z;
    p.anim = m.anim;
    p.last = { x: m.x, y: m.y, z: m.z, t, at: this.time };
    if (p.channel && Math.hypot(p.x - p.channel.x, p.z - p.channel.z) > CHANNEL_CANCEL_M)
      this.cancelChannel(p, 'moved');
  }

  private violation(p: SimPlayer, reason: string) {
    p.violations = p.violations.filter((t) => this.time - t < VIOLATION_WINDOW_SEC);
    p.violations.push(this.time);
    this.send(p.userId, 'correction', { x: p.x, y: p.y, z: p.z, reason });
    if (p.violations.length >= VIOLATION_FLAG_COUNT) this.flags.add(`movement:${p.userId}`);
  }

  jump(uid: string) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const floor = Math.max(
      groundAt(this.map, p.x, p.z),
      depthBand(depthAt(this.map, p.x, p.z, this.waterLevel)) === 'swim'
        ? this.waterLevel
        : -Infinity,
    );
    if (p.y > floor + JUMP_APEX_M * 0.4) return this.deny(uid, 'jump', 'airborne');
    if (sprintLocked(p.stats)) return this.deny(uid, 'jump', 'no_lakas');
    const next = tryJump(p.sprint, this.cfg.actions);
    if (!next) return this.deny(uid, 'jump', 'hingal');
    p.sprint = next;
    p.lastAt.jump = this.time;
  }

  attack(uid: string, m: ClientMessage<'action:attack'>) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const hasAxe = p.equip.hand === 'axe' && countItem(p.bag, 'axe') > 0;
    const candidates: MeleeTarget[] = [];
    for (const c of this.map.chopTargets)
      if ((this.chopsLeft.get(c.id) ?? 0) > 0)
        candidates.push({ id: `chop:${c.id}`, kind: 'chop', x: c.x, z: c.z });
    for (const l of this.map.lootPoints)
      if (l.container === 'box' && !this.lootOpened.has(l.id))
        candidates.push({ id: `loot:${l.id}`, kind: 'crate', x: l.x, z: l.z });
    const r = resolveSwing({
      from: { x: p.x, z: p.z, yaw: m.dir },
      hasAxe,
      now: this.time,
      lastSwingAt: p.lastSwingAt,
      stamina: p.sprint.stamina,
      locked: p.sprint.exhausted || sprintLocked(p.stats),
      candidates,
      cfg: this.cfg.melee,
    });
    if (!r.ok) return this.deny(uid, 'attack', r.reason);
    p.lastSwingAt = this.time;
    p.sprint = {
      ...p.sprint,
      stamina: Math.max(0, p.sprint.stamina - r.staminaCost),
      regenDelay: this.cfg.actions.staminaRegenDelaySec,
    };
    if (p.channel) this.cancelChannel(p, 'acted');
    this.send('all', 'swing', { userId: uid, tool: r.tool, clientSeq: m.clientSeq });
    if (!r.target) return;
    if (r.tool === 'axe') {
      const w = wearTool(p.bag, 'axe');
      if (w) {
        p.bag = w.bag;
        this.dirty.bags.add(uid);
        if (w.broke) {
          if (countItem(p.bag, 'axe') === 0) p.equip.hand = null;
          this.send(uid, 'toast', { key: 'tool_broke', item: 'axe' });
        }
      }
    }
    const [kind, id] = r.target.id.split(':') as [string, string];
    if (kind === 'chop') {
      const target = this.map.chopTargets.find((c) => c.id === id)!;
      this.chopsLeft.set(id, (this.chopsLeft.get(id) ?? 1) - 1);
      this.dirty.chops.add(id);
      const item = target.kind === 'bamboo' ? 'bamboo' : 'wood';
      this.give(p, item, this.cfg.melee.woodPerChop);
      this.send(uid, 'hit', { targetId: r.target.id, item, qty: this.cfg.melee.woodPerChop });
      if ((this.chopsLeft.get(id) ?? 0) === 0) this.learn(uid, 'used_right_tool', true);
    } else if (kind === 'loot') {
      this.openLoot(p, id);
      this.send(uid, 'hit', { targetId: r.target.id });
    }
  }

  // ── Interactions & holds ─────────────────────────────────────────────────

  interact(uid: string, targetId: string) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const [kind, id = ''] = targetId.split(':');
    if (kind === 'loot') {
      const lp = this.map.lootPoints.find((l) => l.id === id);
      if (!lp || this.lootOpened.has(id)) return this.deny(uid, 'interact', 'gone');
      if (dist2(p, lp) > INTERACT_RANGE_M) return this.deny(uid, 'interact', 'too_far');
      this.startChannel(p, {
        kind: 'loot',
        target: id,
        endsAt: this.time + lp.holdSec,
        x: p.x,
        z: p.z,
      });
    } else if (kind === 'drop') {
      const d = this.drops.get(id);
      if (!d) return this.deny(uid, 'interact', 'gone');
      if (dist2(p, d) > INTERACT_RANGE_M) return this.deny(uid, 'interact', 'too_far');
      const r = addItem(p.bag, d.item, d.qty, this.items);
      if (r.added === 0) return this.send(uid, 'bagFull', {});
      p.bag = r.bag;
      this.dirty.bags.add(uid);
      if (r.leftover > 0) d.qty = r.leftover;
      else this.drops.delete(id);
      this.dirty.drops = true;
      this.send(uid, 'picked', { item: d.item, qty: r.added });
    } else if (kind === 'storage') {
      if (!this.atCamp(p)) return this.deny(uid, 'interact', 'not_at_camp');
      this.send(uid, 'storage:open', { activity: this.activity.slice(-30) });
    } else this.deny(uid, 'interact', 'unknown');
  }

  private startChannel(p: SimPlayer, c: Channel) {
    p.channel = c;
    this.send(p.userId, 'channel', { kind: c.kind, target: c.target, endsAt: c.endsAt });
  }

  private cancelChannel(p: SimPlayer, reason: string) {
    if (!p.channel) return;
    this.send(p.userId, 'channel:cancelled', {
      kind: p.channel.kind,
      target: p.channel.target,
      reason,
    });
    p.channel = null;
  }

  private completeChannels() {
    for (const p of this.players.values()) {
      const c = p.channel;
      if (!c || this.time < c.endsAt) continue;
      p.channel = null;
      if (p.life !== 'alive') continue;
      if (c.kind === 'loot') this.openLoot(p, c.target);
      else this.finishCraft(p, c.target);
    }
  }

  private openLoot(p: SimPlayer, id: string) {
    const lp = this.map.lootPoints.find((l) => l.id === id);
    if (!lp || this.lootOpened.has(id)) return;
    this.lootOpened.add(id);
    this.dirty.loot.add(id);
    // Seeded per container + day: same result regardless of who opens it or when in the day.
    const rng = createStateRng(subSeed(this.seed, `loot:${id}:${this.clock.day}`));
    const found = rollLoot({
      zone: lp.zone,
      day: this.clock.day,
      items: this.cfg.items,
      diff: this.diff,
      players: this.players.size,
      session: this.cfg.session,
      rng,
    });
    for (const f of found) this.give(p, f.item, f.qty);
    this.send(p.userId, 'loot:opened', { lootId: id, items: found });
  }

  /** Adds to the bag; whatever doesn't fit drops at the player's feet. */
  private give(p: SimPlayer, item: string, qty: number) {
    const r = addItem(p.bag, item, qty, this.items);
    p.bag = r.bag;
    this.dirty.bags.add(p.userId);
    if (r.leftover > 0) {
      this.spawnDrop({ item, qty: r.leftover, x: p.x, z: p.z });
      this.send(p.userId, 'bagFull', { item, qty: r.leftover });
    }
  }

  private spawnDrop(d: Drop) {
    if (this.drops.size >= MAX_DROPS) {
      const oldest = this.drops.keys().next().value;
      if (oldest) this.drops.delete(oldest);
    }
    this.drops.set(`d${++this.dropSeq}`, d);
    this.dirty.drops = true;
  }

  // ── Bag ──────────────────────────────────────────────────────────────────

  private setBag(p: SimPlayer, bag: Bag) {
    p.bag = bag;
    this.dirty.bags.add(p.userId);
    for (const slot of ['hand', 'body', 'feet'] as const) {
      const it = p.equip[slot];
      if (it && countItem(bag, it) === 0) p.equip[slot] = null;
    }
  }

  bagMove(uid: string, from: number, to: number) {
    const p = this.players.get(uid);
    if (!p || p.life === 'dead') return;
    const b = moveSlot(p.bag, from, to);
    if (b) this.setBag(p, b);
  }

  bagSplit(uid: string, slot: number, qty: number) {
    const p = this.players.get(uid);
    if (!p || p.life === 'dead') return;
    const b = splitSlot(p.bag, slot, qty);
    if (b) this.setBag(p, b);
  }

  bagDrop(uid: string, slot: number, qty: number) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const s = p.bag[slot];
    if (!s) return;
    const n = Math.min(qty, s.qty);
    const next = p.bag.map((x) => (x ? { ...x } : null));
    next[slot] = n >= s.qty ? null : { ...s, qty: s.qty - n };
    this.setBag(p, next);
    this.spawnDrop({
      item: s.item,
      qty: n,
      ...(s.durability !== undefined ? { durability: s.durability } : {}),
      x: p.x,
      z: p.z,
    });
  }

  equip(uid: string, slot: number) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const s = p.bag[slot];
    const where = s && this.items.get(s.item)?.use?.equip;
    if (!s || !where) return this.deny(uid, 'equip', 'not_equippable');
    const wasOn = p.equip[where] === s.item;
    p.equip[where] = wasOn ? null : s.item;
    if (!wasOn) {
      const learning = this.items.get(s.item)?.use?.learning;
      if (learning) this.learn(uid, learning, true);
    }
  }

  useItem(uid: string, slot: number, targetUserId?: string) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const s = p.bag[slot];
    const def: ItemDef | undefined = s ? this.items.get(s.item) : undefined;
    if (!s || !def?.use) return this.deny(uid, 'use', 'not_usable');
    if (def.use.equip) return this.equip(uid, slot);

    let target = p;
    if (targetUserId && targetUserId !== uid) {
      const t = this.players.get(targetUserId);
      if (!t || t.life === 'dead' || t.life === 'disconnected')
        return this.deny(uid, 'use', 'no_target');
      if (def.category !== 'medical') return this.deny(uid, 'use', 'self_only');
      if (dist2(p, t) > GIVE_RANGE_M) return this.deny(uid, 'use', 'too_far');
      target = t;
    }
    const u = def.use;
    const consumable =
      u.hunger !== undefined ||
      u.thirst !== undefined ||
      u.health !== undefined ||
      u.warmth !== undefined ||
      u.energy !== undefined ||
      !!u.cures?.length ||
      !!u.causes?.length;
    if (consumable) {
      const after = removeItem(p.bag, s.item, 1);
      if (!after) return;
      this.setBag(p, after);
      const st = { ...target.stats, effects: [...target.stats.effects] };
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      const healMul = def.category === 'medical' ? this.perk(p, 'healMul') : 1;
      if (u.hunger) st.hunger = clamp(st.hunger + u.hunger);
      if (u.thirst) st.thirst = clamp(st.thirst + u.thirst);
      if (u.health) st.health = clamp(st.health + u.health * healMul);
      if (u.warmth) st.warmth = clamp(st.warmth + u.warmth);
      if (u.energy) st.energy = clamp(st.energy + u.energy);
      for (const c of u.cures ?? []) st.effects = st.effects.filter((e) => e !== c);
      for (const c of u.causes ?? [])
        if (this.rng.chance(c.chance) && !st.effects.includes(c.effect as StatusEffect)) {
          st.effects.push(c.effect as StatusEffect);
          this.send(target.userId, 'effect', { effect: c.effect, on: true });
        }
      target.stats = st;
    }
    if (u.learning) this.learn(uid, u.learning, !/unsafe|dirty/.test(u.learning));
    if (target !== p)
      this.send(target.userId, 'toast', { key: 'healed_by', userId: uid, item: s.item });
  }

  offerGive(uid: string, toUserId: string, slot: number) {
    const p = this.players.get(uid);
    const t = this.players.get(toUserId);
    if (!this.canAct(p) || !t || t.life !== 'alive' || t === p) return;
    const s = p.bag[slot];
    if (!s) return;
    if (dist2(p, t) > GIVE_RANGE_M) return this.deny(uid, 'give', 'too_far');
    const offer: GiveOffer = {
      id: `o${++this.offerSeq}`,
      from: uid,
      to: toUserId,
      slot,
      item: s.item,
      expiresAt: this.time + GIVE_OFFER_SEC,
    };
    this.offers.set(offer.id, offer);
    this.send(toUserId, 'give:offer', {
      offerId: offer.id,
      fromUserId: uid,
      item: s.item,
      qty: s.qty,
      expiresAt: offer.expiresAt,
    });
  }

  acceptGive(uid: string, offerId: string) {
    const o = this.offers.get(offerId);
    if (!o || o.to !== uid) return;
    this.offers.delete(offerId);
    const from = this.players.get(o.from);
    const to = this.players.get(uid);
    if (!this.canAct(from) || !this.canAct(to)) return;
    const s = from.bag[o.slot];
    if (!s || s.item !== o.item) return this.deny(uid, 'give', 'changed');
    if (dist2(from, to) > GIVE_RANGE_M) return this.deny(uid, 'give', 'too_far');
    const r = addItem(to.bag, s.item, s.qty, this.items);
    if (r.added === 0) return this.send(uid, 'bagFull', {});
    // Keep tool wear across hands.
    if (s.durability !== undefined) {
      const i = r.bag.findIndex((x, idx) => x?.item === s.item && !to.bag[idx]);
      if (i >= 0) r.bag[i] = { ...r.bag[i]!, durability: s.durability };
    }
    const fromBag = from.bag.map((x) => (x ? { ...x } : null));
    fromBag[o.slot] = r.leftover > 0 ? { ...s, qty: r.leftover } : null;
    this.setBag(from, fromBag);
    this.setBag(to, r.bag);
    this.send(o.from, 'give:done', { toUserId: uid, item: s.item, qty: r.added });
    this.send(uid, 'give:done', { fromUserId: o.from, item: s.item, qty: r.added });
  }

  private expireOffers() {
    for (const [id, o] of this.offers) if (o.expiresAt < this.time) this.offers.delete(id);
  }

  // ── Camp storage (shared, logged) ────────────────────────────────────────

  atCamp(p: { x: number; z: number }) {
    return inRect(this.map.camp, p.x, p.z);
  }

  deposit(uid: string, item: string, qty: number) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    if (!this.atCamp(p)) return this.deny(uid, 'storage', 'not_at_camp');
    const n = Math.min(qty, countItem(p.bag, item));
    if (n <= 0) return;
    this.setBag(p, removeItem(p.bag, item, n)!);
    this.storage.set(item, (this.storage.get(item) ?? 0) + n);
    this.dirty.storage = true;
    this.logActivity(uid, 'deposit', item, n);
  }

  withdraw(uid: string, item: string, qty: number) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    if (!this.atCamp(p)) return this.deny(uid, 'storage', 'not_at_camp');
    const have = this.storage.get(item) ?? 0;
    const n = Math.min(qty, have);
    if (n <= 0) return;
    const r = addItem(p.bag, item, n, this.items);
    if (r.added === 0) return this.send(uid, 'bagFull', {});
    this.setBag(p, r.bag);
    const left = have - r.added;
    if (left > 0) this.storage.set(item, left);
    else this.storage.delete(item);
    this.dirty.storage = true;
    this.logActivity(uid, 'withdraw', item, r.added);
  }

  private logActivity(userId: string, action: ActivityEntry['action'], item: string, qty: number) {
    const e: ActivityEntry = { at: this.time, day: this.clock.day, userId, action, item, qty };
    this.activity.push(e);
    if (this.activity.length > 500) this.activity.splice(0, this.activity.length - 500);
    this.send('all', 'activityFeed', { ...e });
  }

  // ── Crafting ─────────────────────────────────────────────────────────────

  private craftContext(p: SimPlayer) {
    const sig = this.map.signalSpot;
    return {
      atCamp: this.atCamp(p),
      atSignalSpot: Math.hypot(p.x - sig.x, p.z - sig.z) <= sig.r,
      fireLit: this.fireLit() && dist2(p, this.map.campFire) <= NEAR_FIRE_M * 2,
      workbenchTier: this.camp.workbenchTier,
      materialSaveRatio: this.perk(p, 'materialSaveRatio'),
    };
  }

  craft(uid: string, recipeKey: string) {
    const p = this.players.get(uid);
    if (!this.canAct(p)) return;
    const r = this.cfg.recipes.find((x) => x.key === recipeKey);
    if (!r) return this.deny(uid, 'craft', 'unknown_recipe');
    if (
      r.structure &&
      (UNIQUE_STRUCTURES.has(r.structure) || r.structure === 'campfire') &&
      this.camp.structures.has(r.structure)
    )
      return this.deny(uid, 'craft', 'already_built');
    const check = canCraft(r, p.bag, this.craftContext(p));
    if (!check.ok) return this.deny(uid, 'craft', check.reason);
    const secs = r.seconds / this.perk(p, 'buildSpeedMul');
    this.startChannel(p, {
      kind: 'craft',
      target: r.key,
      endsAt: this.time + secs,
      x: p.x,
      z: p.z,
    });
  }

  private finishCraft(p: SimPlayer, recipeKey: string) {
    const r = this.cfg.recipes.find((x) => x.key === recipeKey);
    if (!r) return;
    const ctx = this.craftContext(p);
    const check = canCraft(r, p.bag, ctx);
    if (!check.ok) return this.deny(p.userId, 'craft', check.reason);
    const res = applyCraft(r, p.bag, this.items, ctx);
    this.setBag(p, res.bag);
    if (res.overflow > 0 && r.output)
      this.spawnDrop({ item: r.output.item, qty: res.overflow, x: p.x, z: p.z });
    if (res.structure) {
      this.camp.structures.add(res.structure);
      if (res.structure === 'campfire') this.camp.fireMinutesLeft = FIRE_BURN_MIN;
      this.dirty.camp = true;
      this.send('all', 'event', { kind: 'built', structure: res.structure, userId: p.userId });
    }
    for (const t of res.brokeTools) this.send(p.userId, 'toast', { key: 'tool_broke', item: t });
    this.logActivity(p.userId, 'craft', r.output?.item ?? r.structure ?? r.key, r.output?.qty ?? 1);
    this.send(p.userId, 'crafted', { recipeKey: r.key });
    if (r.lesson) this.learn(p.userId, `crafted_${r.key}`, true);
  }

  // ── Misc ─────────────────────────────────────────────────────────────────

  setPaused(uid: string, paused: boolean) {
    if (!this.solo || !this.players.has(uid)) return;
    this.paused = paused;
  }

  /** Marks the player as away (Section 16.5: safe, invulnerable, cannot act) or back. */
  setConnected(uid: string, connected: boolean) {
    const p = this.players.get(uid);
    if (!p) return;
    if (!connected && p.life === 'alive') {
      p.life = 'disconnected';
      p.channel = null;
      p.sprint = setSprintIntent(p.sprint, false);
    } else if (connected && p.life === 'disconnected') {
      p.life = 'alive';
      p.last = { x: p.x, y: p.y, z: p.z, t: null, at: this.time };
      p.minOffset = null;
    }
  }

  learn(userId: string | null, eventKey: string, isPositive: boolean) {
    this.learning.push({ userId, day: this.clock.day, eventKey, isPositive });
    if (userId) this.send(userId, 'learning', { key: eventKey, positive: isPositive });
  }

  /** Throttle helper for cosmetic actions (quick chat, pings, emotes). */
  throttle(uid: string, action: string, minSec: number) {
    const p = this.players.get(uid);
    if (!p) return false;
    const last = p.lastAt[action] ?? -Infinity;
    if (this.time - last < minSec) return false;
    p.lastAt[action] = this.time;
    return true;
  }

  drainOut() {
    const o = this.out;
    this.out = [];
    return o;
  }

  takeDirty() {
    const d = this.dirty;
    this.dirty = {
      loot: new Set(),
      drops: false,
      chops: new Set(),
      storage: false,
      camp: false,
      bags: new Set(),
    };
    return d;
  }

  bagWeightOf(p: SimPlayer) {
    return bagWeight(p.bag, this.items);
  }
}
