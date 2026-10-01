import type { Platform, Rect, SurvivalMap, Zone } from './types.ts';

export const inRect = (r: Rect, x: number, z: number) =>
  Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;

export const inBounds = (m: SurvivalMap, x: number, z: number) =>
  Math.abs(x) <= m.halfSize && Math.abs(z) <= m.halfSize;

export function zoneAt(m: SurvivalMap, x: number, z: number): Zone | null {
  // Smallest containing zone wins (camp sits inside the residential area's surroundings).
  let best: Zone | null = null;
  for (const zn of m.zones)
    if (inRect(zn.rect, x, z) && (!best || zn.rect.w * zn.rect.d < best.rect.w * best.rect.d))
      best = zn;
  return best;
}

export function platformAt(m: SurvivalMap, x: number, z: number): Platform | null {
  let best: Platform | null = null;
  for (const p of m.platforms) if (inRect(p, x, z) && (!best || p.top > best.top)) best = p;
  return best;
}

/** Walkable ground height at (x, z): highest platform, else the zone's flooded seabed. */
export function groundAt(m: SurvivalMap, x: number, z: number) {
  const p = platformAt(m, x, z);
  if (p) return p.top;
  return zoneAt(m, x, z)?.seabed ?? 0;
}

/** Floodwater depth above the ground (≤ 0 = dry). */
export const depthAt = (m: SurvivalMap, x: number, z: number, waterLevel: number) =>
  waterLevel - groundAt(m, x, z);

export type DepthBand = 'dry' | 'ankle' | 'knee' | 'waist' | 'swim';
export function depthBand(depth: number): DepthBand {
  if (depth < 0.08) return 'dry';
  if (depth < 0.3) return 'ankle';
  if (depth < 0.55) return 'knee';
  if (depth < 1.2) return 'waist';
  return 'swim';
}

/**
 * Speed multiplier by water depth (a lesson-bearing modifier — kept, unlike tiredness).
 * Same feel as the Signal levels; swimming is slow and needs energy.
 */
export const DEPTH_SPEED: Record<DepthBand, number> = {
  dry: 1,
  ankle: 0.9,
  knee: 0.75,
  waist: 0.55,
  swim: 0.5,
};

export const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
