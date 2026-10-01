import type { SurvivalConfig } from './config.ts';

/**
 * Axe / shove resolution (owner add-on). Server-authoritative: the client plays the swing
 * animation immediately; the server decides what (if anything) was hit.
 * DECISION: no friendly fire — teammates are never valid targets (child-safe co-op).
 */
export type Facing = { x: number; z: number; yaw: number };
export type MeleeTarget = {
  id: string;
  kind: 'chop' | 'crate' | 'critter';
  x: number;
  z: number;
};

/** True if `p` lies within `range` m and ±arc/2 of the facing direction (yaw: atan2(dx, dz)). */
export function inArc(from: Facing, p: { x: number; z: number }, range: number, arcDeg: number) {
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 0.3) return true; // standing on it
  const angle = Math.atan2(dx, dz);
  let diff = angle - from.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= ((arcDeg / 2) * Math.PI) / 180;
}

export type SwingResult =
  | { ok: false; reason: 'cooldown' | 'no_stamina' | 'locked' }
  | { ok: true; tool: 'axe' | 'shove'; target: MeleeTarget | null; staminaCost: number };

/**
 * Resolves a swing. `lastSwingAt`/`now` in seconds. Shoves (no axe) only affect critters
 * (knockback); chopping and breaking crates need the axe.
 */
export function resolveSwing(opts: {
  from: Facing;
  hasAxe: boolean;
  now: number;
  lastSwingAt: number;
  stamina: number;
  /** Sprint/jump/attack locked (Hingal or out of Lakas). */
  locked: boolean;
  candidates: MeleeTarget[];
  cfg: SurvivalConfig['melee'];
}): SwingResult {
  const { cfg } = opts;
  const tool = opts.hasAxe ? 'axe' : 'shove';
  const cooldown = opts.hasAxe ? cfg.axeCooldownSec : cfg.shoveCooldownSec;
  const cost = opts.hasAxe ? cfg.axeStaminaCost : cfg.shoveStaminaCost;
  if (opts.now - opts.lastSwingAt < cooldown) return { ok: false, reason: 'cooldown' };
  if (opts.locked) return { ok: false, reason: 'locked' };
  if (opts.stamina < cost) return { ok: false, reason: 'no_stamina' };
  const range = opts.hasAxe ? cfg.axeRangeM : cfg.shoveRangeM;
  const allowed = opts.candidates.filter(
    (c) => (opts.hasAxe || c.kind === 'critter') && inArc(opts.from, c, range, cfg.axeArcDeg),
  );
  allowed.sort(
    (a, b) =>
      Math.hypot(a.x - opts.from.x, a.z - opts.from.z) -
      Math.hypot(b.x - opts.from.x, b.z - opts.from.z),
  );
  return { ok: true, tool, target: allowed[0] ?? null, staminaCost: cost };
}
