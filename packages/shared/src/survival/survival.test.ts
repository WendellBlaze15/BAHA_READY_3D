import { describe, expect, it } from 'vitest';
import {
  BARANGAY_1,
  DEFAULT_SURVIVAL_CONFIG as CFG,
  addItem,
  advanceClock,
  allDeadOutcome,
  applyCraft,
  bagWeight,
  canCraft,
  countItem,
  createStateRng,
  deathOutcome,
  decideEnding,
  depthAt,
  emptyBag,
  freshStats,
  groundAt,
  helicopterWindowOpen,
  helicopterWindowOver,
  inArc,
  indexItems,
  moveSlot,
  parseClientMessage,
  phaseAt,
  removeItem,
  resolveSwing,
  reviveHealth,
  reviveSeconds,
  rollLoot,
  scaledBoatMaterials,
  splitSlot,
  stormSchedule,
  survivalConfigSchema,
  survivalScore,
  teamScale,
  tickStats,
  validateMove,
  wearTool,
  withActions,
  type MoveContext,
  type StatEnv,
} from './index.ts';

const items = indexItems(CFG.items);
const normal = CFG.difficulties.normal;
const env = (e: Partial<StatEnv> = {}): StatEnv => ({
  night: false,
  hot: false,
  raining: false,
  inWater: false,
  nearFire: false,
  sheltered: false,
  sleeping: false,
  wearingBoots: false,
  wearingRaincoat: false,
  storm: false,
  ...e,
});

describe('config', () => {
  it('the seed config validates (cross-references included)', () => {
    expect(survivalConfigSchema.safeParse(CFG).success).toBe(true);
  });

  it('rejects recipes that reference unknown items', () => {
    const bad = {
      ...CFG,
      recipes: [{ ...CFG.recipes[0]!, inputs: [{ item: 'unobtainium', qty: 1 }] }],
    };
    expect(survivalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('matches the Section 5 difficulty table', () => {
    expect(CFG.difficulties.easy.minutesPerDay).toBe(9);
    expect(CFG.difficulties.hard.deathPenalty).toBe('permadeath');
    expect(CFG.difficulties.normal.stormDays).toEqual([8, 16, 24]);
    expect(CFG.difficulties.hard.heliWindow).toEqual({ start: 10, end: 14 });
  });

  it('reuses the no-slow-motion movement rules of the Signal levels', () => {
    expect(CFG.actions).toEqual(withActions());
  });
});

describe('time & day/night', () => {
  it('phases: dawn 05–06, day, dusk 18–19, night', () => {
    expect(phaseAt(5 * 60 + 30, CFG.session)).toBe('dawn');
    expect(phaseAt(12 * 60, CFG.session)).toBe('day');
    expect(phaseAt(18 * 60 + 30, CFG.session)).toBe('dusk');
    expect(phaseAt(23 * 60, CFG.session)).toBe('night');
    expect(phaseAt(2 * 60, CFG.session)).toBe('night');
  });

  it('a day lasts minutesPerDay real minutes; crossing 05:00 triggers dawn (auto-save)', () => {
    const r = advanceClock(
      { day: 1, minute: 23 * 60 },
      normal.minutesPerDay * 60,
      normal,
      CFG.session,
    );
    expect(r.clock.day).toBe(2);
    expect(r.clock.minute).toBeCloseTo(23 * 60, 5);
    expect(r.crossedDawn).toBe(true);
    const short = advanceClock({ day: 3, minute: 600 }, 10, normal, CFG.session);
    expect(short.crossedDawn).toBe(false);
  });

  it('sleeping runs time faster', () => {
    const awake = advanceClock({ day: 1, minute: 0 }, 60, normal, CFG.session).minutesElapsed;
    const asleep = advanceClock(
      { day: 1, minute: 0 },
      60,
      normal,
      CFG.session,
      true,
    ).minutesElapsed;
    expect(asleep).toBeCloseTo(awake * CFG.session.sleepSpeedup, 6);
  });

  it('helicopter window only on the final day within difficulty hours', () => {
    expect(helicopterWindowOpen({ day: 30, minute: 9 * 60 }, normal, 30)).toBe(true);
    expect(helicopterWindowOpen({ day: 30, minute: 17 * 60 }, normal, 30)).toBe(false);
    expect(helicopterWindowOpen({ day: 29, minute: 9 * 60 }, normal, 30)).toBe(false);
    expect(helicopterWindowOver({ day: 30, minute: 16 * 60 }, normal, 30)).toBe(true);
  });
});

describe('stats & status effects', () => {
  it('hunger and thirst drain; heat makes you thirstier', () => {
    const cool = tickStats(freshStats(), 60, env(), CFG.stats, normal).stats;
    const hot = tickStats(freshStats(), 60, env({ hot: true }), CFG.stats, normal).stats;
    expect(cool.hunger).toBeCloseTo(100 - CFG.stats.hungerPerHour, 5);
    expect(hot.thirst).toBeLessThan(cool.thirst);
  });

  it('cold nights and being wet chill you; a fire warms and dries you', () => {
    let s = tickStats(freshStats(), 600, env({ night: true, inWater: true }), CFG.stats, normal);
    expect(s.stats.warmth).toBeLessThan(40);
    expect(s.stats.effects).toContain('wet');
    s = tickStats(s.stats, 120, env({ nearFire: true }), CFG.stats, normal);
    expect(s.stats.effects).not.toContain('wet');
    expect(s.stats.warmth).toBeGreaterThan(40);
  });

  it('warmth 0 → hypothermia → health drains', () => {
    const r = tickStats(
      { ...freshStats(), warmth: 1 },
      60,
      env({ night: true }),
      CFG.stats,
      normal,
    );
    expect(r.stats.effects).toContain('hypothermia');
    expect(r.stats.health).toBeLessThan(100);
  });

  it('Lakas at 0 only locks sprint/jump ("exhausted") and unlocks after rest', () => {
    let r = tickStats({ ...freshStats(), energy: 1 }, 60, env(), CFG.stats, normal);
    expect(r.stats.effects).toContain('exhausted');
    r = tickStats(r.stats, 120, env({ sleeping: true, sheltered: true }), CFG.stats, normal);
    expect(r.stats.energy).toBeGreaterThanOrEqual(CFG.stats.energyUnlockAt);
    expect(r.stats.effects).not.toContain('exhausted');
  });

  it('leptospirosis risk: wading with an open wound and no boots → infection; boots prevent it', () => {
    const wounded = { ...freshStats(), effects: ['open_wound' as const] };
    const noBoots = tickStats(wounded, 200, env({ inWater: true }), CFG.stats, normal);
    expect(noBoots.stats.effects).toContain('infection');
    const boots = tickStats(
      wounded,
      200,
      env({ inWater: true, wearingBoots: true }),
      CFG.stats,
      normal,
    );
    expect(boots.stats.effects).not.toContain('infection');
  });

  it('emits health_zero once when health runs out', () => {
    const r = tickStats({ ...freshStats(), health: 1, thirst: 0 }, 60, env(), CFG.stats, normal);
    expect(r.stats.health).toBe(0);
    expect(r.events).toContainEqual({ type: 'health_zero' });
  });
});

describe('map', () => {
  it('spawns stand dry on the camp rooftops at Day 1', () => {
    for (const s of BARANGAY_1.spawns)
      expect(depthAt(BARANGAY_1, s.x, s.z, BARANGAY_1.baseWaterLevel)).toBeLessThan(0);
  });
  it('streets start waist-deep; the lake edge is swimming depth', () => {
    expect(depthAt(BARANGAY_1, 20, -30, 1)).toBeCloseTo(1, 5);
    expect(depthAt(BARANGAY_1, 60, 100, 1)).toBeGreaterThan(1.2);
  });
  it('the rescue point is on the far shore, beyond the lake', () => {
    expect(
      groundAt(BARANGAY_1, BARANGAY_1.rescuePoint.x, BARANGAY_1.rescuePoint.z),
    ).toBeGreaterThan(1);
    expect(BARANGAY_1.rescuePoint.z).toBeGreaterThan(110);
  });
  it('every loot point and chop target lies inside the map', () => {
    for (const p of [...BARANGAY_1.lootPoints, ...BARANGAY_1.chopTargets]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(BARANGAY_1.halfSize);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(BARANGAY_1.halfSize);
    }
  });
});

describe('movement validator (server)', () => {
  const ctx = (o: Partial<MoveContext> = {}): MoveContext => ({
    map: BARANGAY_1,
    waterLevel: 1,
    actions: withActions(),
    bag: CFG.bag,
    carryRatio: 0.3,
    sprinting: false,
    onRaft: false,
    swimSpeedMul: 1,
    ...o,
  });
  const roof = { x: 5, y: 4, z: 0, t: 0 };

  it('walking at base speed is valid even with 0 stamina/Lakas (no slow-motion)', () => {
    const next = { x: 5, y: 4, z: 0.3 * 4.6, t: 0.3 };
    expect(validateMove(roof, next, ctx({ sprinting: false })).ok).toBe(true);
  });

  it('sprint speed is valid only while the server says sprint is active', () => {
    const fast = { x: 5, y: 4, z: 1 * 7.3, t: 1 };
    expect(validateMove({ ...roof, z: 0 }, fast, ctx({ sprinting: true })).ok).toBe(true);
    expect(validateMove({ ...roof, z: 0 }, fast, ctx({ sprinting: false }))).toMatchObject({
      ok: false,
      reason: 'too_fast',
    });
  });

  it('no sprint in deep water', () => {
    const street = { x: 20, y: 0, z: -30, t: 0 };
    const v = validateMove(street, { x: 20, y: 0, z: -30 + 6, t: 1 }, ctx({ sprinting: true }));
    expect(v).toMatchObject({ ok: false, reason: 'too_fast' });
  });

  it('jumps within the envelope pass; flying is flagged', () => {
    expect(validateMove(roof, { ...roof, y: 4 + 1.1, t: 0.3 }, ctx()).ok).toBe(true);
    expect(validateMove(roof, { ...roof, y: 4 + 3, t: 0.3 }, ctx())).toMatchObject({
      ok: false,
      reason: 'flying',
    });
  });

  it('climbing out of the water onto a rooftop is allowed', () => {
    const water = { x: 9.5, y: 1, z: 0, t: 0 };
    expect(validateMove(water, { x: 8.5, y: 4, z: 0, t: 0.4 }, ctx()).ok).toBe(true);
  });

  it('too heavy to swim, and map bounds', () => {
    const lake = { x: 60, y: 1, z: 100, t: 0 };
    expect(
      validateMove(lake, { ...lake, x: 60.5, t: 0.5 }, ctx({ carryRatio: 1.2 })),
    ).toMatchObject({ reason: 'too_heavy_to_swim' });
    expect(
      validateMove({ x: 119, y: 0, z: 0, t: 0 }, { x: 121, y: 0, z: 0, t: 1 }, ctx()),
    ).toMatchObject({ reason: 'out_of_bounds' });
  });
});

describe('axe & melee', () => {
  const me = { x: 0, z: 0, yaw: 0 }; // facing +z
  const tree = { id: 't1', kind: 'chop' as const, x: 0, z: 1.5 };
  const base = { from: me, now: 10, lastSwingAt: 0, stamina: 50, locked: false, cfg: CFG.melee };

  it('arc test: in front within range only', () => {
    expect(inArc(me, { x: 0, z: 1.5 }, 2, 100)).toBe(true);
    expect(inArc(me, { x: 0, z: -1.5 }, 2, 100)).toBe(false);
    expect(inArc(me, { x: 0, z: 2.5 }, 2, 100)).toBe(false);
  });

  it('the axe chops a target in front and costs stamina', () => {
    const r = resolveSwing({ ...base, hasAxe: true, candidates: [tree] });
    expect(r).toMatchObject({
      ok: true,
      tool: 'axe',
      target: { id: 't1' },
      staminaCost: CFG.melee.axeStaminaCost,
    });
  });

  it('a shove (no axe) cannot chop; it only pushes critters', () => {
    const rat = { id: 'r1', kind: 'critter' as const, x: 0.5, z: 0.8 };
    expect(resolveSwing({ ...base, hasAxe: false, candidates: [tree] })).toMatchObject({
      ok: true,
      target: null,
    });
    expect(resolveSwing({ ...base, hasAxe: false, candidates: [rat] })).toMatchObject({
      ok: true,
      target: { id: 'r1' },
    });
  });

  it('cooldown, Hingal lock and empty stamina block swings', () => {
    expect(
      resolveSwing({ ...base, hasAxe: true, lastSwingAt: 9.8, candidates: [tree] }),
    ).toMatchObject({ reason: 'cooldown' });
    expect(resolveSwing({ ...base, hasAxe: true, locked: true, candidates: [tree] })).toMatchObject(
      { reason: 'locked' },
    );
    expect(resolveSwing({ ...base, hasAxe: true, stamina: 1, candidates: [tree] })).toMatchObject({
      reason: 'no_stamina',
    });
  });
});

describe('bag', () => {
  it('stacks, weighs and removes items', () => {
    let bag = emptyBag(CFG.bag);
    bag = addItem(bag, 'nails', 150, items).bag;
    expect(countItem(bag, 'nails')).toBe(150);
    expect(bag.filter(Boolean)).toHaveLength(2); // stack 100
    bag = addItem(bag, 'wood', 3, items).bag;
    expect(bagWeight(bag, items)).toBeCloseTo(1.5 + 3, 5);
    bag = removeItem(bag, 'nails', 120)!;
    expect(countItem(bag, 'nails')).toBe(30);
    expect(removeItem(bag, 'nails', 31)).toBeNull();
  });

  it('reports leftovers when the bag is full', () => {
    const full = Array.from({ length: CFG.bag.slots }, () => ({ item: 'wood', qty: 20 }));
    expect(addItem(full, 'rope', 2, items)).toMatchObject({ added: 0, leftover: 2 });
  });

  it('tools wear out and break', () => {
    let bag = addItem(emptyBag(CFG.bag), 'axe', 1, items).bag;
    for (let i = 0; i < 119; i++) bag = wearTool(bag, 'axe')!.bag;
    const last = wearTool(bag, 'axe')!;
    expect(last.broke).toBe(true);
    expect(countItem(last.bag, 'axe')).toBe(0);
  });

  it('moves and splits slots', () => {
    let bag = addItem(emptyBag(CFG.bag), 'wood', 10, items).bag;
    bag = splitSlot(bag, 0, 4)!;
    expect(bag.slice(0, 2)).toEqual([
      { item: 'wood', qty: 6 },
      { item: 'wood', qty: 4 },
    ]);
    expect(moveSlot(bag, 0, 5)![5]).toEqual({ item: 'wood', qty: 6 });
  });
});

describe('crafting', () => {
  const at = { atCamp: true, atSignalSpot: false, fireLit: false, workbenchTier: 1 };
  const recipe = (k: string) => CFG.recipes.find((r) => r.key === k)!;

  it('campfire needs camp, wood and a lighter', () => {
    let bag = addItem(emptyBag(CFG.bag), 'wood', 3, items).bag;
    expect(canCraft(recipe('campfire'), bag, at)).toMatchObject({ reason: 'missing_tools' });
    bag = addItem(bag, 'lighter', 1, items).bag;
    expect(canCraft(recipe('campfire'), bag, { ...at, atCamp: false })).toMatchObject({
      reason: 'not_here',
    });
    expect(canCraft(recipe('campfire'), bag, at).ok).toBe(true);
    const done = applyCraft(recipe('campfire'), bag, items, at);
    expect(done.structure).toBe('campfire');
    expect(countItem(done.bag, 'wood')).toBe(0);
  });

  it('boiling water needs a lit fire and a pot (lesson: safe water)', () => {
    const bag = addItem(
      addItem(emptyBag(CFG.bag), 'dirty_water', 1, items).bag,
      'cooking_pot',
      1,
      items,
    ).bag;
    expect(canCraft(recipe('boiled_water'), bag, at)).toMatchObject({ reason: 'needs_fire' });
    const r = applyCraft(recipe('boiled_water'), bag, items, { ...at, fireLit: true });
    expect(countItem(r.bag, 'boiled_water')).toBe(1);
    expect(countItem(r.bag, 'cooking_pot')).toBe(1); // tools are not consumed
  });

  it('the axe recipe consumes materials and wears the hammer', () => {
    let bag = emptyBag(CFG.bag);
    for (const [k, q] of [
      ['wood', 2],
      ['metal_sheet', 1],
      ['rope', 1],
      ['hammer', 1],
    ] as const)
      bag = addItem(bag, k, q, items).bag;
    const r = applyCraft(recipe('axe'), bag, items, at);
    expect(countItem(r.bag, 'axe')).toBe(1);
    expect(r.bag.find((s) => s?.item === 'hammer')?.durability).toBe(399);
  });

  it('builder perk saves materials (never below 1)', () => {
    const bag = addItem(addItem(emptyBag(CFG.bag), 'tarp', 2, items).bag, 'rope', 2, items).bag;
    const withWood = addItem(bag, 'wood', 4, items).bag;
    const r = applyCraft(recipe('tarp_shelter'), withWood, items, {
      ...at,
      materialSaveRatio: 0.25,
    });
    expect(countItem(r.bag, 'wood')).toBe(1); // 4 − floor(4×0.25)
    expect(countItem(r.bag, 'tarp')).toBe(0); // 2 − floor(0.5) = 2
  });
});

describe('rules: scaling, loot, storms, death, scoring', () => {
  it('team scaling and boat materials', () => {
    expect(teamScale(1, CFG.session)).toBe(1);
    expect(teamScale(5, CFG.session)).toBe(2);
    const s1 = scaledBoatMaterials(CFG.boatStages[0]!, CFG.difficulties.hard, 3, CFG.session);
    expect(s1.find((m) => m.item === 'wood')!.qty).toBe(Math.ceil(12 * 1.3 * 1.5));
  });

  it('loot is deterministic per seed and limited to the zone', () => {
    const roll = (seed: number) =>
      rollLoot({
        zone: 'hardware',
        day: 5,
        items: CFG.items,
        diff: normal,
        players: 2,
        session: CFG.session,
        rng: createStateRng(seed),
      });
    expect(roll(42)).toEqual(roll(42));
    const hwItems = new Set(
      CFG.items.filter((i) => i.zones.includes('hardware')).map((i) => i.key),
    );
    for (const s of [1, 2, 3, 4, 5])
      for (const l of roll(s)) expect(hwItems.has(l.item)).toBe(true);
  });

  it('RNG state resumes exactly (snapshots)', () => {
    const a = createStateRng(7);
    a.next();
    const saved = a.getState();
    const b = createStateRng(saved);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  it('storm schedule includes scheduled days plus spaced random storms on Hard', () => {
    const hard = stormSchedule(CFG.difficulties.hard, 30, createStateRng(3));
    expect(hard.length).toBe(6);
    for (const d of [6, 12, 18, 24]) expect(hard).toContain(d);
  });

  it('death rules per difficulty', () => {
    expect(deathOutcome(CFG.difficulties.easy)).toEqual({
      respawnAtDawn: true,
      spectator: false,
      bag: 'keep',
      statPenaltyRatio: 0.2,
    });
    expect(deathOutcome(normal)).toEqual({
      respawnAtDawn: true,
      spectator: false,
      bag: 'drop_at_death_spot',
      statPenaltyRatio: 0,
    });
    expect(deathOutcome(CFG.difficulties.hard)).toEqual({
      respawnAtDawn: false,
      spectator: true,
      bag: 'drop_at_death_spot',
      statPenaltyRatio: 0,
    });
    expect(allDeadOutcome('easy')).toBe('respawn_with_boat_penalty');
    expect(allDeadOutcome('normal')).toBe('respawn_with_boat_penalty');
    expect(allDeadOutcome('hard')).toBe('run_lost');
  });

  it('revive timing and health', () => {
    expect(reviveSeconds(CFG.session, 'builder', false)).toBe(5);
    expect(reviveSeconds(CFG.session, 'medic', false)).toBe(3);
    expect(reviveSeconds(CFG.session, 'solo', true)).toBe(8);
    expect(reviveHealth('bandage')).toBe(30);
    expect(reviveHealth('first_aid_kit')).toBe(60);
  });

  it('scoring formula (Section 14.3)', () => {
    const s = {
      daysSurvived: 30,
      boatStagesCompleted: 6,
      playersRescued: 3,
      npcsRescued: 2,
      campLevel: 3,
      goodActions: 20,
      deaths: 1,
      hazardHits: 2,
      sicknessEvents: 1,
      ending: 'full_rescue' as const,
    };
    const base = 3000 + 3000 + 3000 + 800 + 900 + 200 - 300 - 200 - 50;
    expect(survivalScore(s, CFG.scoring, normal)).toEqual({ base, final: Math.round(base * 1.5) });
    expect(survivalScore({ ...s, ending: 'failed' }, CFG.scoring, normal).final).toBe(
      Math.round(base * 1.5 * 0.2),
    );
    expect(
      survivalScore(
        {
          ...s,
          daysSurvived: 0,
          boatStagesCompleted: 0,
          playersRescued: 0,
          npcsRescued: 0,
          campLevel: 0,
          goodActions: 0,
          deaths: 9,
        },
        CFG.scoring,
        normal,
      ).final,
    ).toBe(0);
  });

  it('endings', () => {
    expect(
      decideEnding({ rescued: 3, aliveAtWindow: 3, boatComplete: true, signalActive: true }),
    ).toBe('full_rescue');
    expect(
      decideEnding({ rescued: 2, aliveAtWindow: 3, boatComplete: true, signalActive: true }),
    ).toBe('partial_rescue');
    expect(
      decideEnding({ rescued: 3, aliveAtWindow: 3, boatComplete: true, signalActive: false }),
    ).toBe('failed');
    expect(
      decideEnding({ rescued: 0, aliveAtWindow: 3, boatComplete: true, signalActive: true }),
    ).toBe('failed');
  });
});

describe('client messages', () => {
  it('accepts valid payloads and drops unknown types or bad data', () => {
    expect(parseClientMessage('action:attack', { dir: 1.2, clientSeq: 4 })).not.toBeNull();
    expect(parseClientMessage('lobby:setDifficulty', { difficulty: 'easy' })).not.toBeNull();
    expect(parseClientMessage('lobby:setDifficulty', { difficulty: 'nightmare' })).toBeNull();
    expect(parseClientMessage('move', { x: 1, y: 1, z: 1 })).toBeNull();
    expect(parseClientMessage('__proto__', {})).toBeNull();
    expect(parseClientMessage('admin:give', { item: 'axe' })).toBeNull();
    expect(parseClientMessage('chat:send', { text: 'hi', clientMsgId: 'a1', extra: 1 })).toBeNull();
  });
});
