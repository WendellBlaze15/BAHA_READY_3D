import type { ChopTarget, LootPoint, Platform, Rect, SurvivalMap, Zone, ZoneKey } from './types.ts';

/**
 * Handcrafted flooded barangay (Laguna lakeside inspired). Shared by the authoritative game
 * server (validation: bounds, depth, zones, proximity) and the client (rendering).
 * Coordinates in meters; +z points toward the lake and the far-shore rescue point.
 * Streets sit at ground 0 under ~1 m of floodwater at Day 1 (waist-deep); rooftops stay dry.
 */

const r = (x: number, z: number, w: number, d: number): Rect => ({ x, z, w, d });

const zones: Zone[] = [
  {
    key: 'camp_rooftops',
    name: { fil: 'Mga bubong (Kampo)', en: 'Starting rooftops (Camp)' },
    rect: r(0, 4, 26, 26),
    risk: 'low',
    seabed: 0,
  },
  {
    key: 'residential',
    name: { fil: 'Mga kabahayan', en: 'Residential rows' },
    rect: r(-48, 0, 52, 84),
    risk: 'medium',
    seabed: 0,
  },
  {
    key: 'palengke',
    name: { fil: 'Palengke', en: 'Market' },
    rect: r(0, -52, 44, 32),
    risk: 'medium',
    seabed: 0,
  },
  {
    key: 'hardware',
    name: { fil: 'Hardware', en: 'Hardware store' },
    rect: r(46, -32, 26, 22),
    risk: 'medium',
    seabed: 0,
  },
  {
    key: 'health_center',
    name: { fil: 'Health Center', en: 'Health center' },
    rect: r(50, 10, 22, 18),
    risk: 'medium',
    seabed: 0,
  },
  {
    key: 'school',
    name: { fil: 'Paaralan', en: 'School' },
    rect: r(40, 46, 32, 22),
    risk: 'low',
    seabed: 0,
  },
  {
    key: 'church',
    name: { fil: 'Simbahan at kampanaryo', en: 'Church & bell tower' },
    rect: r(-12, 58, 22, 30),
    risk: 'low',
    seabed: 0,
  },
  {
    key: 'power_lines',
    name: { fil: 'Kalye ng poste ng kuryente', en: 'Power-lines street' },
    rect: r(78, -4, 22, 76),
    risk: 'high',
    seabed: 0,
  },
  {
    key: 'lake_edge',
    name: { fil: 'Gilid ng lawa', en: 'Open lake edge' },
    rect: r(0, 96, 240, 32),
    risk: 'high',
    seabed: -2,
  },
  {
    key: 'rescue_shore',
    name: { fil: 'Kabilang pampang', en: 'Far shore (rescue point)' },
    rect: r(0, 116, 60, 12),
    risk: 'low',
    seabed: 0.5,
  },
];

const plat = (
  id: string,
  zone: ZoneKey,
  x: number,
  z: number,
  w: number,
  d: number,
  top: number,
): Platform => ({ id, zone, x, z, w, d, top });

const platforms: Platform[] = [
  // Camp: three connected rooftops + plank bridges.
  plat('camp_roof_a', 'camp_rooftops', -6, 0, 8, 8, 4),
  plat('camp_roof_b', 'camp_rooftops', 5, 0, 8, 10, 4),
  plat('camp_roof_c', 'camp_rooftops', 0, 10, 16, 6, 4),
  plat('camp_bridge_ab', 'camp_rooftops', -1, 0, 3, 1.5, 4),
  plat('camp_bridge_c', 'camp_rooftops', -3, 5.5, 1.5, 3, 4),
  // Residential: half-submerged houses with second floors.
  ...[-28, -8, 12].flatMap((z, i) => [
    plat(`house_${i}a`, 'residential', -32, z, 10, 8, 3),
    plat(`house_${i}b`, 'residential', -56, z, 10, 8, 3),
  ]),
  plat('house_3a', 'residential', -40, 32, 12, 8, 3),
  // Market: low stall tops (flood as storms raise the water).
  plat('stalls_a', 'palengke', -8, -50, 14, 10, 1.4),
  plat('stalls_b', 'palengke', 10, -54, 12, 10, 1.4),
  plat('market_roof', 'palengke', 0, -64, 30, 6, 3.5),
  // Hardware (partly collapsed upper floor), health center, school, church + tower.
  plat('hardware_2f', 'hardware', 46, -32, 22, 18, 3.5),
  plat('health_2f', 'health_center', 50, 10, 18, 14, 4),
  plat('school_roof', 'school', 40, 46, 28, 18, 7),
  plat('church_roof', 'church', -12, 54, 18, 18, 6),
  plat('bell_tower', 'church', -12, 68, 6, 6, 14),
  // Far shore (reachable only by the finished boat — or a very dangerous swim).
  plat('far_shore', 'rescue_shore', 0, 116, 60, 12, 2),
];

/** Deterministic loot spots on a platform: a small grid inset from its edges. */
function spotsOn(
  p: Platform,
  n: number,
  container: LootPoint['container'],
  holdSec: number,
): LootPoint[] {
  const out: LootPoint[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) + 0.5;
    const cz = Math.floor(i / cols) + 0.5;
    out.push({
      id: `${p.id}_l${i}`,
      zone: p.zone,
      x: Math.round((p.x - p.w / 2 + (cx / cols) * p.w) * 10) / 10,
      z: Math.round((p.z - p.d / 2 + (cz / Math.ceil(n / cols)) * p.d) * 10) / 10,
      container,
      holdSec,
    });
  }
  return out;
}
const byId = (id: string) => platforms.find((p) => p.id === id)!;

const lootPoints: LootPoint[] = [
  ...spotsOn(byId('camp_roof_b'), 2, 'box', 1),
  ...platforms.filter((p) => p.zone === 'residential').flatMap((p) => spotsOn(p, 3, 'cabinet', 2)),
  ...spotsOn(byId('stalls_a'), 4, 'shelf', 1.5),
  ...spotsOn(byId('stalls_b'), 4, 'drum', 2),
  ...spotsOn(byId('market_roof'), 2, 'box', 1.5),
  ...spotsOn(byId('hardware_2f'), 6, 'shelf', 2.5),
  ...spotsOn(byId('health_2f'), 4, 'cabinet', 2),
  ...spotsOn(byId('school_roof'), 4, 'box', 1.5),
  ...spotsOn(byId('church_roof'), 3, 'cabinet', 2),
  ...spotsOn(byId('bell_tower'), 1, 'box', 3),
  // Floating debris in the power-lines street and along the lake edge.
  ...[-30, -10, 10, 30].map((z, i): LootPoint => ({
    id: `wires_f${i}`,
    zone: 'power_lines',
    x: 74 + (i % 2) * 6,
    z,
    container: 'floating',
    holdSec: 1,
  })),
  ...[-90, -55, -20, 20, 55, 90].map((x, i): LootPoint => ({
    id: `lake_f${i}`,
    zone: 'lake_edge',
    x,
    z: 94 + (i % 2) * 6,
    container: 'floating',
    holdSec: 1,
  })),
];

const chop = (
  id: string,
  kind: ChopTarget['kind'],
  x: number,
  z: number,
  chops: number,
): ChopTarget => ({ id, kind, x, z, chops });
const chopTargets: ChopTarget[] = [
  // Trees standing out of the water near the houses; bamboo by the lake; debris that floats in.
  chop('tree_res_1', 'tree', -20, -38, 8),
  chop('tree_res_2', 'tree', -20, 22, 8),
  chop('tree_res_3', 'tree', -66, 40, 8),
  chop('tree_school', 'tree', 24, 58, 6),
  chop('bamboo_1', 'bamboo', -40, 84, 6),
  chop('bamboo_2', 'bamboo', 30, 84, 6),
  chop('debris_1', 'debris', -15, 30, 4),
  chop('debris_2', 'debris', 20, -20, 4),
  chop('debris_3', 'debris', 60, 60, 4),
  chop('furniture_res', 'furniture', -32, -8, 3),
  chop('furniture_school', 'furniture', 40, 46, 4),
];

export const BARANGAY_1: SurvivalMap = {
  id: 'barangay-1',
  halfSize: 120,
  baseWaterLevel: 1,
  zones,
  platforms,
  spawns: [
    { x: -6, z: -2 },
    { x: -4, z: 2 },
    { x: 4, z: -2 },
    { x: 6, z: 2 },
    { x: 0, z: 10 },
  ],
  npcSpots: [
    { x: -56, z: -28, zone: 'residential' },
    { x: -40, z: 32, zone: 'residential' },
    { x: 10, z: -64, zone: 'palengke' },
    { x: 50, z: 12, zone: 'health_center' },
    { x: 44, z: 50, zone: 'school' },
    { x: -12, z: 54, zone: 'church' },
  ],
  lootPoints,
  chopTargets,
  hazards: [
    { id: 'wires_1', kind: 'live_wire', rect: r(76, -24, 6, 10), when: 'always' },
    { id: 'wires_2', kind: 'live_wire', rect: r(80, 14, 6, 10), when: 'always' },
    { id: 'current_1', kind: 'current', rect: r(-60, 96, 70, 24), when: 'always' },
    { id: 'current_2', kind: 'current', rect: r(60, 96, 70, 24), when: 'always' },
    { id: 'collapse_hw', kind: 'collapse', rect: r(50, -36, 10, 8), when: 'random' },
    { id: 'rats_market', kind: 'rats', rect: r(0, -52, 30, 20), when: 'night' },
    { id: 'snake_res', kind: 'snake', rect: r(-66, 40, 10, 10), when: 'always' },
    { id: 'snake_lake', kind: 'snake', rect: r(-40, 84, 12, 8), when: 'always' },
  ],
  camp: r(0, 4, 26, 26),
  campStorage: { x: 6, z: 2 },
  campFire: { x: -6, z: 1 },
  boatDock: r(0, 18, 8, 6),
  signalSpot: { x: -14, z: 116, r: 4 },
  rescuePoint: { x: 0, z: 116, r: 10 },
};
