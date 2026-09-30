import type { LevelConfig, LevelMap } from '../level-config.ts';
import { createRng, type Rng } from './rng.ts';

export type Vec2 = { x: number; z: number };

export type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  roof: number;
  kind: 'house' | 'home' | 'evac_center' | 'church' | 'store' | 'hall';
};

export type HazardInstance = {
  id: string;
  key: string;
  pos: Vec2;
  radius: number;
  /** Unit vector of the lateral push for strong_current zones. */
  dir?: Vec2;
};

export type NpcInstance = { id: string; key: string; pos: Vec2 };

export type Prop = {
  kind:
    'fountain' | 'stall' | 'jeepney' | 'tricycle' | 'tree' | 'post' | 'court' | 'bench' | 'sign';
  x: number;
  z: number;
  rot: number;
  color?: number;
};

export type Layout = {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  cell: number;
  roadWidth: number;
  start: Vec2;
  evac: { center: Vec2; radius: number };
  route: Vec2[];
  markers: Vec2[];
  roadsX: number[];
  roadsZ: number[];
  buildings: Building[];
  hazards: HazardInstance[];
  npcs: NpcInstance[];
  props: Prop[];
  plaza: Vec2 | null;
};

export const CELL = 22;
export const ROAD_WIDTH = 6;

const MAP_SIZE: Record<LevelMap, { rows: number; cols: number }> = {
  house: { rows: 1, cols: 1 },
  street: { rows: 3, cols: 1 },
  plaza: { rows: 4, cols: 2 },
  palengke: { rows: 4, cols: 2 },
  night_town: { rows: 5, cols: 2 },
  town: { rows: 6, cols: 3 },
};

const HAZARD_RADIUS: Record<string, number> = {
  open_manhole: 1.0,
  live_wire: 1.6,
  debris: 1.1,
  collapsing_structure: 2.2,
  strong_current: 3.5,
  lightning_exposure: 5,
};

// Bright, saturated blocky palette (walls) and roofs.
const WALLS = [
  0xf2e6c9, 0xf7c873, 0x9fd3c7, 0xf28c8c, 0xb7d77a, 0xe8b4d8, 0x8ec5ff, 0xffd9a0, 0xd9d9d9,
];
const ROOFS = [0xd2402f, 0x2f6f7e, 0x8a6b4a, 0x3f8fd2, 0x2e8b57, 0x6b4e9b];

const round = (n: number) => Math.round(n * 100) / 100;
// DECISION: sqrt (IEEE-exact on every engine) instead of Math.hypot, whose last bit can
// differ between V8 and JavaScriptCore and would desync client/server layouts.
export const dist = (a: Vec2, b: Vec2) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};

/** Deterministic town layout for a level + attempt seed. */
export function generateLayout(config: LevelConfig, seed: number | bigint | string): Layout {
  const rng = createRng(seed);
  const { rows, cols } = MAP_SIZE[config.map];
  const roadsX = Array.from({ length: cols * 2 + 1 }, (_, i) => (i - cols) * CELL);
  const roadsZ = Array.from({ length: rows + 1 }, (_, j) => -j * CELL);

  // Route along the road grid, zig-zagging one column per row at most.
  const route: Vec2[] = [{ x: 0, z: 0 }];
  let col = 0;
  for (let j = 1; j <= rows; j++) {
    route.push({ x: col * CELL, z: -j * CELL });
    if (j < rows && cols > 0) {
      const options = [-1, 0, 1].filter((d) => Math.abs(col + d) <= cols);
      const d = rng.pick(options);
      if (d !== 0) {
        col += d;
        route.push({ x: col * CELL, z: -j * CELL });
      }
    }
  }
  const evacCenter = { x: col * CELL, z: -rows * CELL - 9 };
  route.push(evacCenter);

  const bounds = {
    minX: -(cols + 1) * CELL,
    maxX: (cols + 1) * CELL,
    minZ: -rows * CELL - 26,
    maxZ: CELL,
  };

  const plazaBlock =
    config.map === 'plaza' || config.map === 'town' ? { i: 0, j: Math.floor(rows / 2) } : null;
  const plaza = plazaBlock
    ? { x: (plazaBlock.i + 0.5) * CELL, z: -(plazaBlock.j + 0.5) * CELL }
    : null;
  const marketBlock =
    config.map === 'palengke' || config.map === 'town' ? { i: -1, j: Math.floor(rows / 2) } : null;

  const buildings: Building[] = [];
  const props: Prop[] = [];

  // Player's home (north-east of the start) and the evacuation center.
  buildings.push({ x: 9, z: 9, w: 9, d: 8, h: 5, color: 0xf2e6c9, roof: 0xd2402f, kind: 'home' });
  buildings.push({
    x: evacCenter.x,
    z: evacCenter.z - 11,
    w: 18,
    d: 8,
    h: 6,
    color: 0xeef2f3,
    roof: 0x2e8b57,
    kind: 'evac_center',
  });

  for (let j = -1; j < rows; j++) {
    for (let i = -cols - 1; i < cols + 1; i++) {
      const cx = (i + 0.5) * CELL;
      const cz = -(j + 0.5) * CELL;
      if (j === -1 && i === 0) continue; // home block
      if (plazaBlock && i === plazaBlock.i && j === plazaBlock.j) {
        props.push({ kind: 'fountain', x: cx, z: cz, rot: 0 });
        for (let k = 0; k < 4; k++) {
          props.push({
            kind: 'bench',
            x: cx + (k % 2 ? 5 : -5),
            z: cz + (k < 2 ? 5 : -5),
            rot: (k * Math.PI) / 2,
          });
        }
        continue;
      }
      if (marketBlock && i === marketBlock.i && j === marketBlock.j) {
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 2; b++) {
            props.push({
              kind: 'stall',
              x: cx - 5 + a * 5,
              z: cz - 3 + b * 6,
              rot: 0,
              color: rng.pick(ROOFS),
            });
          }
        }
        continue;
      }
      if (j === Math.max(0, rows - 2) && i === cols) {
        buildings.push({
          x: cx,
          z: cz,
          w: 10,
          d: 13,
          h: 9,
          color: 0xe8dcc8,
          roof: 0xb04a34,
          kind: 'church',
        });
        continue;
      }
      if (j === 0 && i === -1) {
        buildings.push({
          x: cx,
          z: cz,
          w: 12,
          d: 10,
          h: 5,
          color: 0xdfe8ee,
          roof: 0x3f8fd2,
          kind: 'hall',
        });
        continue;
      }
      // 2x2 lots of blocky houses.
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          if (rng.chance(0.12)) {
            props.push({
              kind: 'tree',
              x: round(cx - 4 + a * 8),
              z: round(cz - 4 + b * 8),
              rot: 0,
            });
            continue;
          }
          const w = round(rng.range(4.5, 6.8));
          const d = round(rng.range(4.5, 6.8));
          buildings.push({
            x: round(cx - 4 + a * 8),
            z: round(cz - 4 + b * 8),
            w,
            d,
            h: round(rng.range(3, 7.5)),
            color: rng.pick(WALLS),
            roof: rng.pick(ROOFS),
            kind: rng.chance(0.1) ? 'store' : 'house',
          });
        }
      }
    }
  }

  // Street furniture along roads.
  for (const x of roadsX) {
    for (let z = 4; z > bounds.minZ + 10; z -= 11) {
      if (rng.chance(0.35))
        props.push({ kind: 'post', x: x + ROAD_WIDTH / 2 + 0.6, z: round(z), rot: 0 });
    }
  }
  props.push({ kind: 'jeepney', x: roadsX[0]! + 1.5, z: -CELL / 2, rot: Math.PI / 2 });
  props.push({ kind: 'tricycle', x: 2, z: 6, rot: 0.4 });
  props.push({ kind: 'sign', x: evacCenter.x + 4, z: evacCenter.z + 3, rot: 0 });
  if (config.map === 'town' || config.map === 'plaza')
    props.push({ kind: 'court', x: -(cols + 0.5) * CELL, z: -CELL * 1.5, rot: 0 });

  const segments = route.slice(1).map((b, k) => ({ a: route[k]!, b }));
  const hazards = placeHazards(config, rng, segments, evacCenter, plaza);
  const npcs = placeNpcs(config, rng, segments, hazards, evacCenter);
  const markers = placeMarkers(segments, hazards);

  return {
    bounds,
    cell: CELL,
    roadWidth: ROAD_WIDTH,
    start: { x: 0, z: 2 },
    evac: { center: evacCenter, radius: 6 },
    route,
    markers,
    roadsX,
    roadsZ,
    buildings,
    hazards,
    npcs,
    props,
    plaza,
  };
}

type Segment = { a: Vec2; b: Vec2 };

function pointOnRoute(segments: Segment[], rng: Rng) {
  const lengths = segments.map((s) => dist(s.a, s.b));
  const total = lengths.reduce((a, b) => a + b, 0);
  let r = rng.range(0, total);
  let k = 0;
  while (k < segments.length - 1 && r > lengths[k]!) r -= lengths[k++]!;
  const s = segments[k]!;
  const len = lengths[k]! || 1;
  const t = Math.min(1, Math.max(0, r / len));
  const dir = { x: (s.b.x - s.a.x) / len, z: (s.b.z - s.a.z) / len };
  return { p: { x: s.a.x + (s.b.x - s.a.x) * t, z: s.a.z + (s.b.z - s.a.z) * t }, dir };
}

function placeHazards(
  config: LevelConfig,
  rng: Rng,
  segments: Segment[],
  evac: Vec2,
  plaza: Vec2 | null,
) {
  const out: HazardInstance[] = [];
  const start = { x: 0, z: 0 };
  for (const h of config.hazards) {
    for (let n = 0; n < h.count; n++) {
      const radius = HAZARD_RADIUS[h.key] ?? 1.2;
      let placed: HazardInstance | null = null;
      for (let tries = 0; tries < 30 && !placed; tries++) {
        let pos: Vec2;
        let dir: Vec2 | undefined;
        if (h.key === 'lightning_exposure' && plaza) {
          pos = { x: plaza.x + rng.range(-3, 3), z: plaza.z + rng.range(-3, 3) };
        } else {
          const { p, dir: d } = pointOnRoute(segments, rng);
          const perp = { x: -d.z, z: d.x };
          const side = rng.chance(0.5) ? 1 : -1;
          const off =
            h.key === 'open_manhole'
              ? rng.range(-1.2, 1.2)
              : h.key === 'live_wire'
                ? side * rng.range(1.8, 2.6)
                : h.key === 'collapsing_structure'
                  ? side * 3.4
                  : h.key === 'strong_current'
                    ? 0
                    : side * rng.range(0, 2.2);
          pos = { x: p.x + perp.x * off, z: p.z + perp.z * off };
          if (h.key === 'strong_current') dir = { x: perp.x * side, z: perp.z * side };
        }
        pos = { x: round(pos.x), z: round(pos.z) };
        if (dist(pos, start) < 10 || dist(pos, evac) < 9) continue;
        if (out.some((o) => dist(o.pos, pos) < o.radius + radius + 2)) continue;
        placed = {
          id: `${h.key}_${n}`.replace(/_/g, '-').slice(0, 40),
          key: h.key,
          pos,
          radius,
          ...(dir ? { dir } : {}),
        };
      }
      if (placed) out.push(placed);
    }
  }
  return out;
}

function placeNpcs(
  config: LevelConfig,
  rng: Rng,
  segments: Segment[],
  hazards: HazardInstance[],
  evac: Vec2,
) {
  const out: NpcInstance[] = [];
  config.npcs.forEach((key, n) => {
    for (let tries = 0; tries < 30; tries++) {
      const { p, dir } = pointOnRoute(segments, rng);
      const side = rng.chance(0.5) ? 1 : -1;
      const pos = { x: round(p.x - dir.z * side * 3.6), z: round(p.z + dir.x * side * 3.6) };
      if (dist(pos, { x: 0, z: 0 }) < 12 || dist(pos, evac) < 12) continue;
      if (hazards.some((h) => dist(h.pos, pos) < h.radius + 3)) continue;
      if (out.some((o) => dist(o.pos, pos) < 6)) continue;
      out.push({ id: `npc-${n}-${key}`, key, pos });
      return;
    }
  });
  return out;
}

/** Safe-path markers every ~6m, nudged away from manholes and currents. */
function placeMarkers(segments: Segment[], hazards: HazardInstance[]) {
  const out: Vec2[] = [];
  for (const s of segments) {
    const len = dist(s.a, s.b);
    const steps = Math.max(1, Math.floor(len / 6));
    const dir = { x: (s.b.x - s.a.x) / (len || 1), z: (s.b.z - s.a.z) / (len || 1) };
    for (let k = 0; k < steps; k++) {
      let p = {
        x: s.a.x + (s.b.x - s.a.x) * (k / steps),
        z: s.a.z + (s.b.z - s.a.z) * (k / steps),
      };
      for (const h of hazards) {
        if ((h.key === 'open_manhole' || h.key === 'debris') && dist(h.pos, p) < h.radius + 1.5) {
          const perp = { x: -dir.z, z: dir.x };
          const side = (h.pos.x - p.x) * perp.x + (h.pos.z - p.z) * perp.z > 0 ? -1 : 1;
          p = { x: p.x + perp.x * side * 2.4, z: p.z + perp.z * side * 2.4 };
        }
      }
      out.push({ x: round(p.x), z: round(p.z) });
    }
  }
  return out;
}

/** Apply daily-challenge modifiers deterministically (client and server). */
export function applyDailyModifiers(
  config: LevelConfig,
  modifiers: Record<string, unknown> | null | undefined,
): LevelConfig {
  if (!modifiers) return config;
  const rain = Number(modifiers.rainBoost ?? 0) || 0;
  const rise = Number(modifiers.waterRiseBoost ?? 0) || 0;
  return {
    ...config,
    rainIntensity: Math.min(1, config.rainIntensity + rain),
    waterRiseSpeed: Math.round(config.waterRiseSpeed * (1 + rise) * 10000) / 10000,
    night: config.night || modifiers.night === true,
  };
}
