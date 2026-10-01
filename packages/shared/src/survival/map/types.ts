/** Axis-aligned rectangle: center (x, z), width along x, depth along z (meters). */
export type Rect = { x: number; z: number; w: number; d: number };

export const ZONE_KEYS = [
  'camp_rooftops',
  'residential',
  'palengke',
  'hardware',
  'health_center',
  'school',
  'church',
  'power_lines',
  'lake_edge',
  'rescue_shore',
] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

export type Zone = {
  key: ZoneKey;
  name: { fil: string; en: string };
  rect: Rect;
  risk: 'low' | 'medium' | 'high';
  /** Ground height under the water where no platform stands (m). */
  seabed: number;
};

/** Walkable surface above the flood (rooftops, upper floors, bridges). */
export type Platform = Rect & { id: string; zone: ZoneKey; top: number };

export type LootPoint = {
  id: string;
  zone: ZoneKey;
  x: number;
  z: number;
  container: 'cabinet' | 'box' | 'drum' | 'shelf' | 'floating';
  /** Interaction hold time (s). */
  holdSec: number;
};

/** Axe targets: chopping yields wood/bamboo (Section owner add-on). */
export type ChopTarget = {
  id: string;
  kind: 'tree' | 'debris' | 'furniture' | 'bamboo';
  x: number;
  z: number;
  /** Chops before it is used up (refills after storms for floating debris). */
  chops: number;
};

export type HazardZone = {
  id: string;
  kind: 'live_wire' | 'current' | 'collapse' | 'rats' | 'snake';
  rect: Rect;
  /** Active only at night (rats) or when shaking (collapse) etc. — resolved by the server. */
  when: 'always' | 'night' | 'random';
};

export type SurvivalMap = {
  id: string;
  /** Half-extent of the playable square (m). */
  halfSize: number;
  /** Flood level at Day 1 (m); rises with storms. */
  baseWaterLevel: number;
  zones: Zone[];
  platforms: Platform[];
  spawns: { x: number; z: number }[];
  npcSpots: { x: number; z: number; zone: ZoneKey }[];
  lootPoints: LootPoint[];
  chopTargets: ChopTarget[];
  hazards: HazardZone[];
  camp: Rect;
  campStorage: { x: number; z: number };
  campFire: { x: number; z: number };
  boatDock: Rect;
  signalSpot: { x: number; z: number; r: number };
  rescuePoint: { x: number; z: number; r: number };
};
